import type { ContestPrize, DeliveryMethod, GiftDelivery, TelegramGift } from '@prisma/client';
import { audit } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import { TelegramError } from '../../telegram/client.js';
import { sendTemplate } from '../../telegram/messenger.js';
import { apiForBot, mainApi } from '../../telegram/registry.js';
import { escapeHtml } from '../../templates/render.js';
import { queue, QUEUES, type GiftDeliveryJob } from '../../queues/index.js';
import { nftProviders } from '../nft/providers.js';

// Telegram Premium gift prices in Stars (giftPremiumSubscription)
const PREMIUM_STAR_COST: Record<number, number> = { 3: 1000, 6: 1500, 12: 2500 };

/** Chooses how a prize can actually be delivered. Never pretends to automate what the API can't do. */
export function chooseMethod(prize: ContestPrize & { gift: TelegramGift | null }): { method: DeliveryMethod; note?: string } {
  switch (prize.kind) {
    case 'GIFT': {
      if (prize.businessOwnedGiftId) return { method: 'BUSINESS_TRANSFER' };
      const g = prize.gift;
      if (!g) return { method: 'MANUAL', note: 'Подарок не выбран из каталога' };
      if (g.type === 'COLLECTIBLE' || g.type === 'NFT')
        return { method: 'MANUAL', note: 'Коллекционный подарок передаётся только из аккаунта владельца (Telegram Business) или вручную' };
      if (g.availability === 'REMOVED' || g.availability === 'SOLD_OUT' || g.type === 'REMOVED')
        return { method: 'MANUAL', note: 'Подарок больше недоступен для покупки ботом — нужна ручная выдача' };
      if (!g.transferable) return { method: 'MANUAL', note: 'Отправка этого подарка ботом не подтверждена getAvailableGifts' };
      return { method: 'BOT_SEND_GIFT' };
    }
    case 'PREMIUM':
      return PREMIUM_STAR_COST[prize.premiumMonths ?? 0]
        ? { method: 'PREMIUM_GIFT' }
        : { method: 'MANUAL', note: 'Premium можно подарить ботом только на 3, 6 или 12 месяцев' };
    case 'NFT':
      return { method: 'NFT_PROVIDER' };
    case 'STARS':
      return {
        method: 'MANUAL',
        note: 'Bot API не позволяет боту переводить Stars пользователю напрямую. Выдайте Stars вручную или замените приз на подарок соответствующей стоимости.',
      };
    default:
      return { method: 'MANUAL', note: 'Приз выдаётся вручную' };
  }
}

export async function createDeliveriesForDraw(contestId: string, drawNumber: number) {
  const contest = await prisma.contest.findUniqueOrThrow({ where: { id: contestId } });
  const winners = await prisma.contestWinner.findMany({
    where: { contestId, drawNumber, status: 'ACTIVE', prizeId: { not: null } },
    include: { prize: { include: { gift: true } } },
  });
  for (const w of winners) {
    const prize = w.prize!;
    const { method, note } = chooseMethod(prize);
    const d = await prisma.giftDelivery.upsert({
      where: { idempotencyKey: `winner:${w.id}` },
      create: {
        idempotencyKey: `winner:${w.id}`,
        botId: contest.botId,
        contestId,
        winnerId: w.id,
        prizeId: prize.id,
        giftId: prize.giftId,
        recipientTgId: w.tgUserId,
        recipientName: w.username ? `@${w.username}` : w.firstName,
        method,
        status: method === 'MANUAL' ? 'MANUAL_REQUIRED' : 'PENDING',
        note,
      },
      update: {},
    });
    if (d.status === 'PENDING') await enqueueDelivery(d.id);
    else if (d.status === 'MANUAL_REQUIRED') await notifyOwnerManual(d.id);
  }
}

export async function enqueueDelivery(deliveryId: string) {
  await queue(QUEUES.giftDelivery).add('deliver', { deliveryId } satisfies GiftDeliveryJob, { jobId: `delivery__${deliveryId}__${Date.now()}` });
}

class RetryableError extends Error {}

export async function processDelivery(deliveryId: string): Promise<GiftDelivery> {
  const d = await prisma.giftDelivery.findUniqueOrThrow({
    where: { id: deliveryId },
    include: { prize: { include: { gift: true, nftAsset: true } }, bot: true, contest: true },
  });
  if (d.status === 'DELIVERED' || d.status === 'MANUAL_REQUIRED') return d;

  // Crash-safety: if a previous attempt reached PROCESSING we cannot know whether Telegram
  // executed the call. Never resend blindly — ask the owner to verify.
  const claimed = await prisma.giftDelivery.updateMany({
    where: { id: d.id, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'PROCESSING', attempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    const updated = await prisma.giftDelivery.update({
      where: { id: d.id },
      data: { status: 'MANUAL_REQUIRED', note: 'Предыдущая попытка прервалась — проверьте получение вручную' },
    });
    await notifyOwnerManual(d.id);
    return updated;
  }

  const api = apiForBot(d.bot);
  const prize = d.prize;
  const comment = d.contest ? `Приз конкурса «${d.contest.title}»` : undefined;
  try {
    switch (d.method) {
      case 'BOT_SEND_GIFT': {
        const gift = prize?.gift;
        if (!gift) throw new Error('Подарок не найден');
        if (gift.starCost) {
          const bal = await api.getMyStarBalance().catch(() => null);
          if (bal && bal.amount < gift.starCost) {
            throw new Error(`Недостаточно Stars на балансе бота: ${bal.amount} < ${gift.starCost}. Пополните баланс бота.`);
          }
        }
        await api.sendGift(d.recipientTgId, gift.telegramGiftId, comment?.slice(0, 128));
        break;
      }
      case 'PREMIUM_GIFT': {
        const months = prize?.premiumMonths ?? 0;
        await api.giftPremiumSubscription(d.recipientTgId, months, PREMIUM_STAR_COST[months]!, comment?.slice(0, 128));
        break;
      }
      case 'BUSINESS_TRANSFER': {
        const owned = await prisma.businessOwnedGift.findFirst({
          where: { id: prize?.businessOwnedGiftId ?? '' },
          include: { connection: true },
        });
        if (!owned) throw new Error('Подарок из аккаунта Business не найден');
        if (!owned.connection.isEnabled || !owned.connection.canTransferGifts)
          throw new Error('Business-подключение не имеет права передачи подарков');
        await api.transferGift(owned.connection.connectionId, owned.ownedGiftId, d.recipientTgId, owned.transferStarCount ?? undefined);
        await prisma.businessOwnedGift.delete({ where: { id: owned.id } });
        break;
      }
      case 'NFT_PROVIDER': {
        const asset = prize?.nftAsset;
        if (!asset) throw new Error('NFT не выбран');
        const provider = nftProviders[asset.provider];
        if (!provider?.canTransfer) {
          await prisma.giftDelivery.update({
            where: { id: d.id },
            data: { status: 'MANUAL_REQUIRED', note: `Провайдер «${asset.provider}» не поддерживает автоматическую передачу` },
          });
          await notifyOwnerManual(d.id);
          return prisma.giftDelivery.findUniqueOrThrow({ where: { id: d.id } });
        }
        const ref = await provider.transfer(asset, d.recipientTgId);
        await prisma.nFTAsset.update({ where: { id: asset.id }, data: { status: 'TRANSFERRED', transferRef: ref } });
        break;
      }
      default:
        throw new Error('Метод требует ручной выдачи');
    }
  } catch (e) {
    const retryable = e instanceof TelegramError && (e.isRateLimit || e.code >= 500);
    const message = e instanceof Error ? e.message : String(e);
    await prisma.giftDelivery.update({
      where: { id: d.id },
      data: { status: retryable ? 'PENDING' : 'FAILED', error: message.slice(0, 1000) },
    });
    if (retryable) throw new RetryableError(message);
    await notifyOwnerManual(d.id, message);
    await audit('delivery.failed', { entity: 'GiftDelivery', entityId: d.id, meta: { error: message }, level: 'warn' });
    return prisma.giftDelivery.findUniqueOrThrow({ where: { id: d.id } });
  }

  const done = await prisma.giftDelivery.update({ where: { id: d.id }, data: { status: 'DELIVERED', deliveredAt: new Date(), error: null } });
  await sendTemplate(api, { ownerId: d.bot.ownerId, botId: d.botId }, d.recipientTgId, 'GIFT_RECEIVED', {
    username: d.recipientName,
    gift_name: prize?.title,
    prize_name: prize?.title,
    contest_name: d.contest?.title,
  }).catch(() => undefined); // user may not have started the bot
  return done;
}

/** Owner gets a DM from the platform bot with instructions for manual delivery. */
export async function notifyOwnerManual(deliveryId: string, error?: string) {
  const d = await prisma.giftDelivery.findUnique({
    where: { id: deliveryId },
    include: { bot: { include: { owner: true } }, prize: true, contest: true },
  });
  const owner = d?.bot.owner;
  if (!d || !owner) return;
  const lines = [
    '🎁 <b>Требуется ручная выдача приза</b>',
    d.contest ? `Конкурс: ${escapeHtml(d.contest.title)}` : '',
    `Приз: ${escapeHtml(d.prize?.title ?? '—')}`,
    `Победитель: ${escapeHtml(d.recipientName ?? '')} (ID <code>${d.recipientTgId}</code>)`,
    d.note ? `Причина: ${escapeHtml(d.note)}` : '',
    error ? `Ошибка: ${escapeHtml(error)}` : '',
    '',
    'Отправьте приз вручную и отметьте выдачу в панели: Telegram Gifts → История выдачи.',
  ].filter(Boolean);
  await mainApi.sendMessage(owner.telegramId, lines.join('\n')).catch(() => undefined);
}

export async function markDeliveredManually(deliveryId: string, userId: string) {
  const d = await prisma.giftDelivery.update({
    where: { id: deliveryId },
    data: { status: 'DELIVERED', method: 'MANUAL', deliveredAt: new Date(), deliveredBy: userId, error: null },
  });
  await audit('delivery.manual_confirmed', { actorId: userId, entity: 'GiftDelivery', entityId: deliveryId });
  return d;
}
