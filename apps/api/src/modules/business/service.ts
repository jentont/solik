import type { Prisma, TelegramBot } from '@prisma/client';
import { audit } from '../../lib/audit.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { apiForBot } from '../../telegram/registry.js';
import type { TgBusinessConnection } from '../../telegram/types.js';

/**
 * Telegram Business: the account owner connects the bot in Telegram
 * (Settings → Telegram Business → Chatbots) and grants rights. Telegram then sends a
 * `business_connection` update. Nothing is stored in the browser and no user sessions
 * (MTProto) are used — only the official Bot API rights the user granted.
 */
export async function handleBusinessConnection(bot: TelegramBot, c: TgBusinessConnection) {
  const owner = await prisma.user.findUnique({ where: { telegramId: BigInt(c.user.id) } });
  const rights = c.rights ?? {};
  const data = {
    isEnabled: c.is_enabled,
    rights: rights as Prisma.InputJsonValue,
    canViewGifts: !!rights.can_view_gifts_and_stars,
    canTransferGifts: !!rights.can_transfer_and_upgrade_gifts,
    canTransferStars: !!rights.can_transfer_stars,
    lastCheckedAt: new Date(),
  };
  const conn = await prisma.telegramBusinessConnection.upsert({
    where: { connectionId: c.id },
    create: { connectionId: c.id, botId: bot.id, ownerId: owner?.id, tgUserId: BigInt(c.user.id), userChatId: BigInt(c.user_chat_id), ...data },
    update: { ownerId: owner?.id, ...data },
  });
  await audit(c.is_enabled ? 'business.connected' : 'business.disabled', { actorId: owner?.id, entity: 'TelegramBusinessConnection', entityId: conn.id, meta: { rights } });
  if (conn.isEnabled && conn.canViewGifts) await syncOwnedGifts(conn.id).catch(() => undefined);
}

export async function refreshBusinessConnection(id: string, userId: string) {
  const conn = await prisma.telegramBusinessConnection.findUnique({ where: { id }, include: { bot: true } });
  if (!conn || conn.ownerId !== userId) throw notFound('Подключение не найдено');
  const info = await apiForBot(conn.bot).getBusinessConnection(conn.connectionId);
  await handleBusinessConnection(conn.bot, { id: info.id, user: info.user, user_chat_id: info.user_chat_id, date: 0, is_enabled: info.is_enabled, rights: info.rights });
  return prisma.telegramBusinessConnection.findUniqueOrThrow({ where: { id } });
}

/** Imports gifts owned by the business account (used as prizes via transferGift). */
export async function syncOwnedGifts(id: string) {
  const conn = await prisma.telegramBusinessConnection.findUniqueOrThrow({ where: { id }, include: { bot: true } });
  if (!conn.canViewGifts) throw forbidden('Нет права просмотра подарков в Business-подключении');
  const res = await apiForBot(conn.bot).getBusinessAccountGifts(conn.connectionId);
  const seen: string[] = [];
  for (const g of res.gifts as any[]) {
    const ownedGiftId: string | undefined = g.owned_gift_id;
    if (!ownedGiftId) continue;
    seen.push(ownedGiftId);
    const isUnique = g.type === 'unique';
    const name = isUnique ? `${g.gift?.base_name ?? 'Gift'} #${g.gift?.number ?? ''}` : g.gift?.sticker?.emoji ?? 'Gift';
    await prisma.businessOwnedGift.upsert({
      where: { connectionId_ownedGiftId: { connectionId: conn.id, ownedGiftId } },
      create: {
        connectionId: conn.id,
        ownedGiftId,
        telegramGiftId: isUnique ? null : g.gift?.id,
        isUnique,
        name,
        canBeTransferred: isUnique ? !!g.can_be_transferred : false,
        transferStarCount: g.transfer_star_count ?? null,
        raw: g,
      },
      update: { name, canBeTransferred: isUnique ? !!g.can_be_transferred : false, transferStarCount: g.transfer_star_count ?? null, raw: g, syncedAt: new Date() },
    });
  }
  await prisma.businessOwnedGift.deleteMany({ where: { connectionId: conn.id, ownedGiftId: { notIn: seen }, reservedForPrizeId: null } });
  return prisma.businessOwnedGift.findMany({ where: { connectionId: conn.id }, orderBy: { syncedAt: 'desc' } });
}

export async function disconnectBusiness(id: string, userId: string) {
  const conn = await prisma.telegramBusinessConnection.findUnique({ where: { id } });
  if (!conn || conn.ownerId !== userId) throw notFound('Подключение не найдено');
  // The actual disconnect happens in Telegram settings; here we stop using it.
  await prisma.telegramBusinessConnection.update({ where: { id }, data: { isEnabled: false } });
  await audit('business.disconnect', { actorId: userId, entity: 'TelegramBusinessConnection', entityId: id });
}
