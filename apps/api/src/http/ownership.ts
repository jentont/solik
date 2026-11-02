import { notFound } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

// Every lookup is scoped by owner: a foreign id behaves exactly like a missing one (404),
// so ids of other users' resources can't be probed.

export async function ownBot(userId: string, botId: string) {
  const bot = await prisma.telegramBot.findFirst({ where: { id: botId, ownerId: userId } });
  if (!bot) throw notFound('Бот не найден');
  return bot;
}

/** Bot usable for contests by this user: own white-label bot, or the platform bot. */
export async function usableBot(userId: string, botId: string) {
  const bot = await prisma.telegramBot.findFirst({ where: { id: botId, OR: [{ ownerId: userId }, { isPlatform: true }] } });
  if (!bot) throw notFound('Бот не найден');
  return bot;
}

export async function ownChat(userId: string, chatId: string) {
  const chat = await prisma.telegramChat.findFirst({ where: { id: chatId, OR: [{ ownerId: userId }, { bot: { ownerId: userId } }] } });
  if (!chat) throw notFound('Чат не найден');
  return chat;
}

export async function ownChannel(userId: string, channelId: string) {
  const ch = await prisma.telegramChannel.findFirst({ where: { id: channelId, OR: [{ ownerId: userId }, { bot: { ownerId: userId } }] } });
  if (!ch) throw notFound('Канал не найден');
  return ch;
}

export async function ownContest(userId: string, contestId: string) {
  const c = await prisma.contest.findFirst({ where: { id: contestId, ownerId: userId } });
  if (!c) throw notFound('Конкурс не найден');
  return c;
}

export async function ownMedia(userId: string, mediaId: string) {
  const m = await prisma.mediaFile.findFirst({ where: { id: mediaId, ownerId: userId } });
  if (!m) throw notFound('Файл не найден');
  return m;
}
