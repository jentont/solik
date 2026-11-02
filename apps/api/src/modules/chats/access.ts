import type { TelegramBot } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import type { TelegramApi } from '../../telegram/client.js';
import type { TgMessage, TgUser } from '../../telegram/types.js';
import { platformOwnerIds } from '../../config/env.js';

/** Admin check for chat commands, cached for 60 s. Anonymous admins post as the chat itself. */
export async function isChatAdmin(api: TelegramApi, msg: TgMessage): Promise<boolean> {
  if (msg.sender_chat && msg.sender_chat.id === msg.chat.id) return true;
  if (msg.sender_chat?.type === 'channel') {
    const chat = await prisma.telegramChat.findFirst({ where: { chatId: BigInt(msg.chat.id) } });
    if (chat?.linkedChannelChatId && chat.linkedChannelChatId === BigInt(msg.sender_chat.id)) return true;
  }
  if (!msg.from) return false;
  const key = `admin:${msg.chat.id}:${msg.from.id}`;
  const cached = await redis().get(key);
  if (cached !== null) return cached === '1';
  const member = await api.getChatMember(msg.chat.id, msg.from.id).catch(() => null);
  const ok = !!member && (member.status === 'creator' || member.status === 'administrator');
  await redis().set(key, ok ? '1' : '0', 'EX', 60);
  return ok;
}

export async function ensureUser(u: TgUser) {
  return prisma.user.upsert({
    where: { telegramId: BigInt(u.id) },
    create: {
      telegramId: BigInt(u.id),
      username: u.username,
      firstName: u.first_name,
      lastName: u.last_name,
      languageCode: u.language_code,
      role: platformOwnerIds.has(String(u.id)) ? 'OWNER' : 'USER',
    },
    update: { username: u.username, firstName: u.first_name, lastName: u.last_name },
  });
}

/** Who owns contests created from inside a chat. */
export async function resolveChatOwner(bot: TelegramBot, chatTgId: number, actor?: TgUser): Promise<string | null> {
  if (bot.ownerId) return bot.ownerId;
  const chat = await prisma.telegramChat.findUnique({ where: { botId_chatId: { botId: bot.id, chatId: BigInt(chatTgId) } } });
  if (chat?.ownerId) return chat.ownerId;
  if (actor) return (await ensureUser(actor)).id;
  return null;
}
