import { audit } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { mainApi } from '../../telegram/registry.js';
import type { TgPreCheckoutQuery, TgSuccessfulPayment, TgUser } from '../../telegram/types.js';
import { ensureDefaultPlan } from './plans.js';

const DAY = 86_400_000;
// Telegram Stars subscriptions currently support exactly a 30-day period.
const TG_SUBSCRIPTION_PERIOD_SEC = 2_592_000;

/** Usable = bot may run and create contests. */
export function isSubscriptionUsable(s: { status: string; periodEnd: Date | null; graceUntil: Date | null }, now = Date.now()) {
  if (s.status === 'ACTIVE' || s.status === 'CANCELLED') return !!s.periodEnd && s.periodEnd.getTime() > now;
  if (s.status === 'GRACE') return !!s.graceUntil && s.graceUntil.getTime() > now;
  return false;
}

/** Next period, extending from the current end if it hasn't passed (early renewal keeps remaining days). */
export function nextPeriod(currentEnd: Date | null, periodDays: number, now = new Date()) {
  const start = currentEnd && currentEnd > now ? currentEnd : now;
  return { start, end: new Date(start.getTime() + periodDays * DAY) };
}

/** Creates (or renews) a white-label slot and returns a Telegram Stars invoice link from the main bot. */
export async function createSubscriptionInvoice(userId: string, opts: { planId?: string; subscriptionId?: string; autoRenew?: boolean }) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  let sub = opts.subscriptionId ? await prisma.botSubscription.findUnique({ where: { id: opts.subscriptionId }, include: { plan: true } }) : null;
  if (opts.subscriptionId && (!sub || sub.ownerId !== userId)) throw notFound('Подписка не найдена');
  if (!sub) {
    const plan = opts.planId ? await prisma.whiteLabelPlan.findUnique({ where: { id: opts.planId } }) : await ensureDefaultPlan();
    if (!plan || !plan.isActive) throw badRequest('Тариф недоступен');
    // reuse an unpaid slot instead of piling up PENDING rows
    sub =
      (await prisma.botSubscription.findFirst({ where: { ownerId: userId, status: 'PENDING', planId: plan.id }, include: { plan: true } })) ??
      (await prisma.botSubscription.create({
        data: { ownerId: userId, planId: plan.id, priceStars: plan.priceStars, autoRenew: opts.autoRenew ?? true },
        include: { plan: true },
      }));
  }
  const autoRenew = opts.autoRenew ?? sub.autoRenew;
  // Renewals use the current plan price (admin may have changed it)
  const price = sub.status === 'PENDING' ? sub.priceStars : sub.plan.priceStars;
  if (price !== sub.priceStars || autoRenew !== sub.autoRenew) {
    sub = await prisma.botSubscription.update({ where: { id: sub.id }, data: { priceStars: price, autoRenew }, include: { plan: true } });
  }
  const recurring = autoRenew && sub.plan.periodDays === 30 && !sub.subscriptionChargeId;
  const link = await mainApi.createInvoiceLink({
    title: `${sub.plan.name}: собственный бот`,
    description: `Подписка на White-Label бота на ${sub.plan.periodDays} дней${recurring ? ' с автопродлением (можно отменить в любой момент)' : ''}.`,
    payload: `sub:${sub.id}`,
    amount: price,
    label: `${sub.plan.periodDays} дней`,
    subscription_period: recurring ? TG_SUBSCRIPTION_PERIOD_SEC : undefined,
  });
  await audit('subscription.invoice', { actorId: userId, entity: 'BotSubscription', entityId: sub.id, meta: { price, recurring, tg: user.telegramId } });
  return { link, subscriptionId: sub.id, price, recurring };
}

export async function handleSubscriptionPreCheckout(q: TgPreCheckoutQuery) {
  const sub = await prisma.botSubscription.findUnique({ where: { id: q.invoice_payload.slice(4) }, include: { owner: true } });
  if (!sub) return mainApi.answerPreCheckoutQuery(q.id, false, 'Подписка не найдена');
  if (sub.owner.telegramId !== BigInt(q.from.id)) return mainApi.answerPreCheckoutQuery(q.id, false, 'Счёт выставлен другому пользователю');
  if (q.currency !== 'XTR' || q.total_amount !== sub.priceStars) return mainApi.answerPreCheckoutQuery(q.id, false, 'Стоимость изменилась — запросите новый счёт');
  return mainApi.answerPreCheckoutQuery(q.id, true);
}

/** successful_payment for `sub:` payloads (first payment and automatic recurring renewals). Idempotent. */
export async function handleSubscriptionPayment(from: TgUser, p: TgSuccessfulPayment) {
  const subId = p.invoice_payload.slice(4);
  const result = await prisma.$transaction(async (tx) => {
    const dup = await tx.subscriptionPayment.findUnique({ where: { telegramPaymentChargeId: p.telegram_payment_charge_id } });
    if (dup) return null;
    await tx.$queryRaw`SELECT id FROM "BotSubscription" WHERE id = ${subId} FOR UPDATE`;
    const sub = await tx.botSubscription.findUnique({ where: { id: subId }, include: { plan: true } });
    if (!sub) return null;
    const { start, end: computedEnd } = nextPeriod(sub.periodEnd, sub.plan.periodDays);
    const end = p.subscription_expiration_date ? new Date(p.subscription_expiration_date * 1000) : computedEnd;
    await tx.subscriptionPayment.create({
      data: {
        subscriptionId: sub.id,
        amount: p.total_amount,
        telegramPaymentChargeId: p.telegram_payment_charge_id,
        isRecurring: !!p.is_recurring,
        periodStart: start,
        periodEnd: end,
      },
    });
    const updated = await tx.botSubscription.update({
      where: { id: sub.id },
      data: {
        status: 'ACTIVE',
        periodStart: sub.periodStart && sub.status !== 'PENDING' && sub.status !== 'EXPIRED' ? sub.periodStart : start,
        periodEnd: end,
        graceUntil: null,
        notifiedExpiringAt: null,
        ...(p.is_first_recurring || (p.subscription_expiration_date && !sub.subscriptionChargeId)
          ? { subscriptionChargeId: p.telegram_payment_charge_id, autoRenew: true }
          : {}),
      },
    });
    if (updated.botId) {
      await tx.telegramBot.updateMany({ where: { id: updated.botId, status: 'SUBSCRIPTION_EXPIRED' }, data: { status: 'ACTIVE' } });
    }
    return updated;
  });
  if (!result) return;
  await audit('subscription.paid', { entity: 'BotSubscription', entityId: result.id, meta: { amount: p.total_amount, recurring: p.is_recurring, tg: from.id } });
  await mainApi
    .sendMessage(
      from.id,
      `✅ Оплата получена: ${p.total_amount} ⭐\nПодписка активна до <b>${result.periodEnd!.toLocaleDateString('ru-RU')}</b>.${
        result.botId ? '' : '\n\nТеперь подключите своего бота: отправьте /newbot и токен от @BotFather или откройте панель.'
      }`,
    )
    .catch(() => undefined);
}

export async function setAutoRenew(subscriptionId: string, userId: string, enabled: boolean) {
  const sub = await prisma.botSubscription.findUnique({ where: { id: subscriptionId }, include: { owner: true } });
  if (!sub || sub.ownerId !== userId) throw notFound('Подписка не найдена');
  if (sub.status === 'PENDING' || sub.status === 'EXPIRED') throw conflict('Подписка не активна');
  if (sub.subscriptionChargeId) {
    // Real Telegram mechanism; requires the user's explicit action in our UI
    await mainApi.editUserStarSubscription(sub.owner.telegramId, sub.subscriptionChargeId, !enabled);
  } else if (enabled) {
    throw badRequest('Автопродление включается при следующей оплате');
  }
  const updated = await prisma.botSubscription.update({
    where: { id: sub.id },
    data: enabled ? { autoRenew: true, status: 'ACTIVE', cancelledAt: null } : { autoRenew: false, status: 'CANCELLED', cancelledAt: new Date() },
  });
  await audit(enabled ? 'subscription.resume' : 'subscription.cancel', { actorId: userId, entity: 'BotSubscription', entityId: sub.id });
  return updated;
}

/** Periodic job: expiry notices, grace period, expiration. Data is never deleted. */
export async function runSubscriptionMaintenance(now = new Date()) {
  const soon = new Date(now.getTime() + 3 * DAY);
  const expiring = await prisma.botSubscription.findMany({
    where: { status: { in: ['ACTIVE', 'CANCELLED'] }, periodEnd: { lte: soon, gt: now }, notifiedExpiringAt: null },
    include: { owner: true, bot: true },
  });
  for (const s of expiring) {
    const renewing = s.status === 'ACTIVE' && s.autoRenew && s.subscriptionChargeId;
    await mainApi
      .sendMessage(
        s.owner.telegramId,
        renewing
          ? `ℹ️ Подписка на бота ${s.bot ? '@' + s.bot.username : ''} будет автоматически продлена ${s.periodEnd!.toLocaleDateString('ru-RU')} (${s.priceStars} ⭐).`
          : `⏳ Подписка на бота ${s.bot ? '@' + s.bot.username : ''} заканчивается ${s.periodEnd!.toLocaleDateString('ru-RU')}. Продлите её в панели, чтобы бот продолжил работу.`,
      )
      .catch(() => undefined);
    await prisma.botSubscription.update({ where: { id: s.id }, data: { notifiedExpiringAt: now } });
  }

  const ended = await prisma.botSubscription.findMany({
    where: { status: { in: ['ACTIVE', 'CANCELLED'] }, periodEnd: { lte: now } },
    include: { plan: true, owner: true },
  });
  for (const s of ended) {
    const graceUntil = new Date(s.periodEnd!.getTime() + s.plan.graceDays * DAY);
    await prisma.botSubscription.update({ where: { id: s.id }, data: { status: 'GRACE', graceUntil } });
    await mainApi
      .sendMessage(s.owner.telegramId, `⚠️ Подписка закончилась. Бот работает в льготном режиме до ${graceUntil.toLocaleDateString('ru-RU')}. Продлите подписку в панели.`)
      .catch(() => undefined);
  }

  const expired = await prisma.botSubscription.findMany({ where: { status: 'GRACE', graceUntil: { lte: now } }, include: { owner: true } });
  for (const s of expired) {
    await prisma.$transaction([
      prisma.botSubscription.update({ where: { id: s.id }, data: { status: 'EXPIRED' } }),
      ...(s.botId ? [prisma.telegramBot.updateMany({ where: { id: s.botId, status: 'ACTIVE' }, data: { status: 'SUBSCRIPTION_EXPIRED' } })] : []),
    ]);
    await audit('subscription.expired', { entity: 'BotSubscription', entityId: s.id, level: 'warn' });
    await mainApi
      .sendMessage(s.owner.telegramId, '⛔ Подписка истекла. Данные, конкурсы и история сохранены, но новые конкурсы недоступны. Продлите подписку, чтобы восстановить работу бота.')
      .catch(() => undefined);
  }
  return { notified: expiring.length, grace: ended.length, expired: expired.length };
}

/** Returns a usable, free slot for attaching a new bot. Platform admins don't need one. */
export async function findFreeSlot(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const slots = await prisma.botSubscription.findMany({ where: { ownerId: userId, botId: null, status: { in: ['ACTIVE', 'CANCELLED', 'GRACE'] } } });
  const slot = slots.find((s) => isSubscriptionUsable(s));
  if (!slot && user.role === 'USER') throw forbidden('Для подключения собственного бота нужна активная подписка White-Label');
  return slot ?? null;
}
