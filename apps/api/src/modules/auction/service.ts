import type { Contest, ContestPrize, TelegramBot } from '@prisma/client';
import { contestEvent } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import type { TelegramApi } from '../../telegram/client.js';
import { sendTemplate } from '../../telegram/messenger.js';
import { apiForBot } from '../../telegram/registry.js';
import type { TgMessage, TgPreCheckoutQuery, TgSuccessfulPayment, TgUser } from '../../telegram/types.js';
import { formatDuration, mention } from '../../templates/render.js';
import { finishContest, prizeTitle } from '../contests/lifecycle.js';
import { scheduleAuctionTimers } from './timers.js';

export interface AuctionConfig {
  // invoice: bids are Stars invoices paid to the bot; paid_messages: chat has paid messages enabled
  bidMode: 'invoice' | 'paid_messages';
  startBid: number;
  minStep: number;
  minPaidStars: number;
  extendSeconds: number;
  refundOutbid: boolean; // invoice mode: refund the previous leader when outbid
  warnings: number[]; // seconds-left warnings
  countdownStyle: 'messages' | 'edit';
  countdownWithoutBids: boolean;
}

export function auctionConfig(c: Pick<Contest, 'config'>): AuctionConfig {
  const cfg = (c.config ?? {}) as Partial<AuctionConfig>;
  return {
    bidMode: cfg.bidMode === 'paid_messages' ? 'paid_messages' : 'invoice',
    minPaidStars: Math.max(1, Number(cfg.minPaidStars ?? 1)),
    warnings: Array.isArray(cfg.warnings) ? cfg.warnings.map(Number).filter((n) => n > 10) : [60, 30],
    countdownStyle: cfg.countdownStyle === 'edit' ? 'edit' : 'messages',
    countdownWithoutBids: Boolean(cfg.countdownWithoutBids ?? false),
    startBid: Math.max(1, Number(cfg.startBid ?? 10)),
    minStep: Math.max(1, Number(cfg.minStep ?? 1)),
    extendSeconds: Math.min(3600, Math.max(15, Number(cfg.extendSeconds ?? 180))),
    refundOutbid: Boolean(cfg.refundOutbid ?? false),
  };
}

/** Minimum acceptable next bid. */
export function minNextBid(c: Pick<Contest, 'currentBid' | 'config'>): number {
  const cfg = auctionConfig(c);
  return c.currentBid == null ? cfg.startBid : c.currentBid + cfg.minStep;
}

export type BidCheck = { ok: true } | { ok: false; reason: string };

export function validateBid(c: Pick<Contest, 'status' | 'endsAt' | 'currentBid' | 'config' | 'leaderTgId'>, amount: number, userId: bigint, now = Date.now()): BidCheck {
  if (c.status !== 'ACTIVE') return { ok: false, reason: 'Перебивка не активна' };
  if (!c.endsAt || c.endsAt.getTime() <= now) return { ok: false, reason: 'Перебивка уже завершена' };
  if (c.leaderTgId != null && c.leaderTgId === userId) return { ok: false, reason: 'Вы уже лидируете' };
  const min = minNextBid(c);
  if (!Number.isInteger(amount) || amount < min) return { ok: false, reason: `Минимальная ставка: ${min} Stars` };
  if (amount > 100000) return { ok: false, reason: 'Слишком большая ставка' };
  return { ok: true };
}

/** Issues a personal Stars invoice link for a bid. Payment, not the message, is what counts. */
export async function createBidInvoice(api: TelegramApi, contest: Contest & { prizes: ContestPrize[] }, user: TgUser, requested?: number) {
  const amount = requested ?? minNextBid(contest);
  const check = validateBid(contest, amount, BigInt(user.id));
  if (!check.ok) return check;
  const tx = await prisma.starsTransaction.create({
    data: { botId: contest.botId, contestId: contest.id, tgUserId: BigInt(user.id), username: user.username, amount, kind: 'BID' },
  });
  const link = await api.createInvoiceLink({
    title: `Ставка ${amount} Stars`,
    description: `Перебивка «${contest.title}». Приз: ${prizeTitle(contest.prizes)}`.slice(0, 255),
    payload: `bid:${tx.id}`,
    amount,
    label: 'Ставка',
  });
  return { ok: true as const, link, amount, txId: tx.id };
}

/** pre_checkout_query must be answered within 10 seconds. */
export async function handleBidPreCheckout(api: TelegramApi, q: TgPreCheckoutQuery) {
  const txId = q.invoice_payload.slice('bid:'.length);
  const tx = await prisma.starsTransaction.findUnique({ where: { id: txId }, include: { contest: true } });
  const reject = async (reason: string) => {
    if (tx) await prisma.starsTransaction.update({ where: { id: tx.id }, data: { status: 'REJECTED', refundReason: reason } }).catch(() => undefined);
    await api.answerPreCheckoutQuery(q.id, false, reason);
  };
  if (!tx || !tx.contest || tx.status !== 'PENDING') return reject('Счёт недействителен. Запросите новый.');
  if (q.currency !== 'XTR' || q.total_amount !== tx.amount) return reject('Сумма не совпадает со счётом');
  if (BigInt(q.from.id) !== tx.tgUserId) return reject('Этот счёт выставлен другому участнику');
  const check = validateBid(tx.contest, tx.amount, tx.tgUserId);
  if (!check.ok) return reject(check.reason);
  await api.answerPreCheckoutQuery(q.id, true);
}

/**
 * Applies a confirmed payment. Idempotent by telegram_payment_charge_id; the contest row
 * is locked so concurrent bids are serialized. A payment that lost the race (or arrived
 * after the end) is refunded automatically.
 */
export async function handleBidPayment(bot: TelegramBot, from: TgUser, payment: TgSuccessfulPayment) {
  const api = apiForBot(bot);
  const txId = payment.invoice_payload.slice('bid:'.length);
  const chargeId = payment.telegram_payment_charge_id;

  const outcome = await prisma.$transaction(async (db) => {
    const dup = await db.starsTransaction.findUnique({ where: { telegramPaymentChargeId: chargeId } });
    if (dup) return { kind: 'duplicate' as const };
    const tx = await db.starsTransaction.findUnique({ where: { id: txId } });
    if (!tx || !tx.contestId) return { kind: 'unknown' as const };
    if (BigInt(from.id) !== tx.tgUserId || payment.total_amount !== tx.amount || payment.currency !== 'XTR') {
      await db.starsTransaction.update({ where: { id: tx.id }, data: { telegramPaymentChargeId: chargeId, status: 'PAID', refundReason: 'mismatch' } });
      return { kind: 'refund' as const, tx, reason: 'Платёж не совпадает со счётом' };
    }
    await db.$queryRaw`SELECT id FROM "Contest" WHERE id = ${tx.contestId} FOR UPDATE`;
    const contest = await db.contest.findUniqueOrThrow({ where: { id: tx.contestId } });
    await db.starsTransaction.update({ where: { id: tx.id }, data: { telegramPaymentChargeId: chargeId, status: 'PAID' } });
    const check = validateBid(contest, tx.amount, tx.tgUserId);
    if (!check.ok) return { kind: 'refund' as const, tx, reason: check.reason };

    const cfg = auctionConfig(contest);
    const prevLeaderTx =
      cfg.refundOutbid && contest.leaderTgId != null
        ? await db.starsTransaction.findFirst({ where: { contestId: contest.id, status: 'APPLIED', tgUserId: contest.leaderTgId }, orderBy: { createdAt: 'desc' } })
        : null;
    const endsAt = new Date(Date.now() + cfg.extendSeconds * 1000);
    const updated = await db.contest.update({
      where: { id: contest.id },
      data: {
        currentBid: tx.amount,
        leaderTgId: tx.tgUserId,
        leaderName: from.username ? `@${from.username}` : from.first_name,
        endsAt,
        timerVersion: { increment: 1 },
        bidsCount: { increment: 1 },
      },
    });
    await db.starsTransaction.update({ where: { id: tx.id }, data: { status: 'APPLIED' } });
    await db.contestParticipant.upsert({
      where: { contestId_tgUserId: { contestId: contest.id, tgUserId: tx.tgUserId } },
      create: { contestId: contest.id, tgUserId: tx.tgUserId, username: from.username, firstName: from.first_name, score: tx.amount },
      update: { score: tx.amount, username: from.username, firstName: from.first_name },
    });
    return { kind: 'applied' as const, contest: updated, tx, prevLeaderTx };
  });

  if (outcome.kind === 'refund') {
    await api.refundStarPayment(outcome.tx.tgUserId, chargeId).then(
      () => prisma.starsTransaction.update({ where: { id: outcome.tx.id }, data: { status: 'REFUNDED', refundReason: outcome.reason } }),
      (e) => contestEvent(outcome.tx.contestId!, 'bid.refund_failed', { chargeId, error: String(e) }),
    );
    await api.sendMessage(from.id, `Ставка не принята: ${outcome.reason}. Stars возвращены.`).catch(() => undefined);
    return outcome;
  }
  if (outcome.kind !== 'applied') return outcome;

  const { contest, prevLeaderTx } = outcome;
  if (prevLeaderTx?.telegramPaymentChargeId) {
    await api
      .refundStarPayment(prevLeaderTx.tgUserId, prevLeaderTx.telegramPaymentChargeId)
      .then(() => prisma.starsTransaction.update({ where: { id: prevLeaderTx.id }, data: { status: 'REFUNDED', refundReason: 'outbid' } }))
      .catch((e) => contestEvent(contest.id, 'bid.refund_failed', { error: String(e) }));
  }
  await contestEvent(contest.id, 'bid.applied', { tgUserId: outcome.tx.tgUserId, amount: outcome.tx.amount });
  await scheduleAuctionTimers(contest.id);
  if (contest.targetChatTgId) {
    await sendTemplate(api, { ownerId: contest.ownerId, botId: contest.botId }, contest.targetChatTgId, 'AUCTION_BID', {
      leader: mention(from),
      username: mention(from),
      current_bid: contest.currentBid,
      stars_amount: contest.currentBid,
      contest_name: contest.title,
      remaining_time: formatDuration(contest.endsAt!.getTime() - Date.now()),
    }).catch(() => undefined);
  }
  return outcome;
}


/**
 * «Перебивка» in a chat with paid messages enabled: every message the sender paid Stars for
 * (Message.paid_star_count, charged by Telegram itself) makes them the leader and resets the timer.
 * Unpaid messages never count. Idempotent per (chat, message).
 */
export async function handlePaidMessageBid(bot: TelegramBot, msg: TgMessage): Promise<boolean> {
  const paid = msg.paid_star_count ?? 0;
  if (!msg.from || msg.from.is_bot || paid <= 0) return false;
  const chatTgId = BigInt(msg.chat.id);
  const contest = await prisma.contest.findFirst({
    where: { botId: bot.id, type: 'STARS_AUCTION', status: 'ACTIVE', targetChatTgId: chatTgId },
  });
  if (!contest) return false;
  const cfg = auctionConfig(contest);
  if (cfg.bidMode !== 'paid_messages') return false;
  const from = msg.from;
  const key = `pm:${msg.chat.id}:${msg.message_id}`;

  const updated = await prisma.$transaction(async (db) => {
    if (await db.starsTransaction.findUnique({ where: { telegramPaymentChargeId: key } })) return null;
    await db.$queryRaw`SELECT id FROM "Contest" WHERE id = ${contest.id} FOR UPDATE`;
    const c = await db.contest.findUniqueOrThrow({ where: { id: contest.id } });
    // not checking endsAt: after an outage Telegram delivers already-paid messages late, and they still count
    if (c.status !== 'ACTIVE') return null;
    if (paid < cfg.minPaidStars) return null;
    await db.starsTransaction.create({
      data: { botId: bot.id, contestId: c.id, tgUserId: BigInt(from.id), username: from.username, amount: paid, kind: 'PAID_MESSAGE', status: 'APPLIED', telegramPaymentChargeId: key },
    });
    await db.contestParticipant.upsert({
      where: { contestId_tgUserId: { contestId: c.id, tgUserId: BigInt(from.id) } },
      create: { contestId: c.id, tgUserId: BigInt(from.id), username: from.username, firstName: from.first_name, score: paid },
      update: { score: { increment: paid }, username: from.username },
    });
    if (c.leaderTgId === BigInt(from.id)) {
      // leader writes again: just extend the timer
      return db.contest.update({ where: { id: c.id }, data: { endsAt: new Date(Date.now() + cfg.extendSeconds * 1000), timerVersion: { increment: 1 }, bidsCount: { increment: 1 }, currentBid: (c.currentBid ?? 0) + paid } });
    }
    return db.contest.update({
      where: { id: c.id },
      data: {
        leaderTgId: BigInt(from.id),
        leaderName: from.username ? `@${from.username}` : from.first_name,
        currentBid: (c.currentBid ?? 0) + paid,
        endsAt: new Date(Date.now() + cfg.extendSeconds * 1000),
        timerVersion: { increment: 1 },
        bidsCount: { increment: 1 },
      },
    });
  });
  if (!updated) return true;
  await contestEvent(contest.id, 'bid.paid_message', { tgUserId: from.id, paid });
  await scheduleAuctionTimers(contest.id);
  await sendTemplate(
    apiForBot(bot),
    { ownerId: contest.ownerId, botId: bot.id },
    msg.chat.id,
    'AUCTION_BID',
    { leader: mention(from), username: mention(from), current_bid: updated.currentBid, stars_amount: updated.currentBid, contest_name: contest.title, remaining_time: formatDuration(cfg.extendSeconds * 1000) },
    { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } },
  ).catch(() => undefined);
  return true;
}

/** Timer job handler: warnings (60/30 s), countdown 10..1, end. */
/** True if a «N seconds left» message is no longer true by more than 3 s. */
export function isLateTick(endsAt: Date | null, secondsLeft: number, now = Date.now()): boolean {
  if (!endsAt) return true;
  return Math.abs((endsAt.getTime() - now) / 1000 - secondsLeft) > 3;
}

export async function handleAuctionTimer(job: { contestId: string; version: number; kind: 'checkpoint' | 'countdown' | 'end'; secondsLeft: number }) {
  const c = await prisma.contest.findUnique({ where: { id: job.contestId }, include: { bot: true } });
  if (!c || c.status !== 'ACTIVE' || c.timerVersion !== job.version || !c.targetChatTgId) return;
  const api = apiForBot(c.bot);
  const cfg = auctionConfig(c);
  const ctx = { ownerId: c.ownerId, botId: c.botId };
  const leader = c.leaderName ?? 'нет ставок';

  if (job.kind === 'end') {
    if (c.endsAt && c.endsAt.getTime() > Date.now() + 1000) return; // extended meanwhile
    await finishContest(c.id);
    return;
  }
  // a tick that fired late (queue backlog after downtime) would print a wrong number: drop it
  if (isLateTick(c.endsAt, job.secondsLeft)) return;
  if (job.kind === 'checkpoint') {
    if (!cfg.warnings.includes(job.secondsLeft) || c.leaderTgId == null) return;
    await sendTemplate(api, ctx, c.targetChatTgId, 'AUCTION_WARNING', {
      leader,
      remaining_time: `${job.secondsLeft} секунд`,
      current_bid: c.currentBid ?? 0,
      contest_name: c.title,
    });
    return;
  }
  if (c.leaderTgId == null && !cfg.countdownWithoutBids) return;
  if (cfg.countdownStyle === 'messages') {
    await sendTemplate(api, ctx, c.targetChatTgId, 'AUCTION_COUNTDOWN', { remaining_time: job.secondsLeft, leader, contest_name: c.title });
    return;
  }
  const text = `<b>${job.secondsLeft}</b>\nЛидер: ${leader}`;
  const key = `auction:countdown:${c.id}:${c.timerVersion}`;
  const existing = await redis().get(key);
  if (existing) {
    await api.editMessageText(c.targetChatTgId, Number(existing), text).catch(() => undefined);
  } else {
    const msg = await api.sendMessage(c.targetChatTgId, text);
    await redis().set(key, String(msg.message_id), 'EX', 120);
  }
}
