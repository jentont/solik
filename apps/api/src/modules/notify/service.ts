import type { TelegramBot } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { queue, QUEUES, type NotificationJob } from '../../queues/index.js';
import type { TelegramApi } from '../../telegram/client.js';
import type { TgMessage } from '../../telegram/types.js';
import { escapeHtml } from '../../templates/render.js';
import { prizeTitle } from '../contests/lifecycle.js';

const DAY = 24 * 3600;
// people who wrote in the chat during this window get the DM
const AUDIENCE_DAYS = 30;
const MAX_RECIPIENTS = 5000;

const MODE_LINE: Record<string, string> = {
  STARS_AUCTION: 'Перебивка: пиши платное сообщение в чате — оно перебивает прошлое. Чьё последнее, когда таймер дошёл до нуля, тот и забрал приз.',
  SMS_COUNTER: 'SMS Counter: успей написать в чат и попасть в список.',
  FIRST_COMMENT: 'Первый комментарий: кто первым ответит под постом, тот и выиграл.',
  DICE_777: 'Конкурс 777: крути слот в чате, три семёрки — приз.',
  MESSAGE_GIVEAWAY: 'Пиши в чат: любое сообщение может выиграть подарок.',
  ACTIVITY: 'Конкурс активности: самые активные получат призы.',
  RANDOM: 'Розыгрыш: нажми «Участвовать» под постом.',
  GIFTS: 'Розыгрыш подарков: нажми «Участвовать» под постом.',
  NFT: 'Розыгрыш NFT: нажми «Участвовать» под постом.',
};

/** Remembers that a user writes in this chat. One DB write per user, chat and day. */
export async function rememberChatMember(bot: TelegramBot, msg: TgMessage) {
  const f = msg.from;
  if (!f || f.is_bot || msg.sender_chat) return;
  const fresh = await redis().set(`aud:${bot.id}:${msg.chat.id}:${f.id}`, '1', 'EX', DAY, 'NX');
  if (!fresh) return;
  const key = { botId: bot.id, chatTgId: BigInt(msg.chat.id), tgUserId: BigInt(f.id) };
  await prisma.chatAudience.upsert({ where: { botId_chatTgId_tgUserId: key }, create: key, update: { lastSeenAt: new Date() } });
}

function postLink(chat: { chatId: bigint; username: string | null } | null, messageId: number | null) {
  if (!chat || !messageId) return null;
  if (chat.username) return `https://t.me/${chat.username}/${messageId}`;
  const id = chat.chatId.toString();
  return id.startsWith('-100') ? `https://t.me/c/${id.slice(4)}/${messageId}` : null;
}

/** DMs everyone active in the contest's chat (who has started this bot and not muted it) that a contest began. */
export async function notifyContestStarted(contestId: string) {
  const c = await prisma.contest.findUnique({
    where: { id: contestId },
    include: { prizes: true, chat: true, channel: { include: { discussionChat: true } }, owner: { select: { telegramId: true } } },
  });
  if (!c) return 0;
  const audienceChat = c.chat ?? c.channel?.discussionChat ?? null;
  if (!audienceChat) return 0;
  const since = new Date(Date.now() - AUDIENCE_DAYS * DAY * 1000);
  const seen = await prisma.chatAudience.findMany({
    where: { botId: c.botId, chatTgId: audienceChat.chatId, lastSeenAt: { gte: since } },
    select: { tgUserId: true },
    orderBy: { lastSeenAt: 'desc' },
    take: MAX_RECIPIENTS,
  });
  if (!seen.length) return 0;
  const users = await prisma.botUser.findMany({
    where: { botId: c.botId, notify: true, isBlocked: false, tgUserId: { in: seen.map((s) => s.tgUserId) } },
    select: { tgUserId: true },
  });
  const ownerTg = c.owner?.telegramId;
  const place = c.channel?.title ?? c.chat?.title ?? 'чате';
  const link = c.channel ? postLink({ chatId: c.channel.chatId, username: c.channel.username }, c.publishedMessageId) : postLink(c.chat, c.publishedMessageId);
  const prize = prizeTitle(c.prizes);
  const html = [
    `<b>В «${escapeHtml(place)}» начался конкурс</b>`,
    escapeHtml(c.title),
    prize ? `Приз: <b>${escapeHtml(prize)}</b>` : '',
    '',
    MODE_LINE[c.type] ?? '',
  ]
    .filter((l, i, a) => l || (i > 0 && a[i - 1]))
    .join('\n');
  const buttons: NotificationJob['buttons'] = [
    ...(link ? [{ text: 'Открыть конкурс', url: link }] : []),
    { text: 'Не присылать такие уведомления', callback: 'notify:off' },
  ];
  const jobs = users
    .filter((u) => u.tgUserId !== ownerTg)
    .map((u) => ({
      name: 'contest-started',
      data: { botId: c.botId, chatId: u.tgUserId.toString(), html, buttons } satisfies NotificationJob,
      opts: { jobId: `notify__${c.id}__${u.tgUserId}` },
    }));
  if (jobs.length) await queue(QUEUES.notification).addBulk(jobs);
  return jobs.length;
}

/** /notify in a private chat, or the «Не присылать» button. */
export async function setNotify(api: TelegramApi, bot: TelegramBot, tgUserId: number, on: boolean | 'toggle') {
  const row = await prisma.botUser.findUnique({ where: { botId_tgUserId: { botId: bot.id, tgUserId: BigInt(tgUserId) } } });
  const next = on === 'toggle' ? !(row?.notify ?? true) : on;
  await prisma.botUser.upsert({
    where: { botId_tgUserId: { botId: bot.id, tgUserId: BigInt(tgUserId) } },
    create: { botId: bot.id, tgUserId: BigInt(tgUserId), notify: next },
    update: { notify: next },
  });
  return next;
}

export const notifyStatusText = (on: boolean) =>
  on
    ? 'Уведомления включены. Я напишу, когда в твоих чатах начнётся конкурс. Выключить: /notify'
    : 'Уведомления выключены. Включить снова: /notify';
