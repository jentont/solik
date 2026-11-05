import type { Prisma, TelegramBot } from '@prisma/client';
import { contestEvent } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import type { TelegramApi } from '../../telegram/client.js';
import { apiForBot } from '../../telegram/registry.js';
import type { TgMessage } from '../../telegram/types.js';
import { escapeHtml } from '../../templates/render.js';
import { isChatAdmin } from '../chats/access.js';
import { auctionConfig } from './service.js';
import { scheduleAuctionTimers } from './timers.js';

export const MIN_TIMER = 15;
export const MAX_TIMER = 3600;

const UNIT: Record<string, number> = { с: 1, сек: 1, s: 1, м: 60, мин: 60, m: 60, ч: 3600, h: 3600 };

/** `.таймер 2м` / `/timer 90` → seconds; `.таймер` alone → 'show'; anything else → null. */
export function parseTimerCommand(text: string | undefined): number | 'show' | 'invalid' | null {
  const m = (text ?? '').trim().match(/^[./](?:таймер|timer)(?:@\w+)?(?:\s+(.+))?$/i);
  if (!m) return null;
  const arg = (m[1] ?? '').trim().toLowerCase().replace(',', '.');
  if (!arg) return 'show';
  const v = arg.match(/^(\d+(?:\.\d+)?)\s*(с|сек|s|м|мин|m|ч|h)?$/);
  if (!v) return 'invalid';
  const sec = Math.round(Number(v[1]) * (UNIT[v[2] ?? 'с'] ?? 1));
  return sec >= MIN_TIMER && sec <= MAX_TIMER ? sec : 'invalid';
}

export function formatTimer(sec: number) {
  if (sec % 60 === 0) return `${sec / 60} мин`;
  if (sec > 60) return `${Math.floor(sec / 60)} мин ${sec % 60} сек`;
  return `${sec} сек`;
}

/**
 * Changes how long the auction waits after each bid. The running countdown is cut down too
 * (never extended), so «3 мин → 2 мин» takes effect right away.
 */
export async function setAuctionTimer(contestId: string, seconds: number) {
  const s = Math.min(MAX_TIMER, Math.max(MIN_TIMER, Math.round(seconds)));
  const updated = await prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "Contest" WHERE id = ${contestId} FOR UPDATE`;
    const c = await db.contest.findUniqueOrThrow({ where: { id: contestId } });
    if (c.type !== 'STARS_AUCTION' || c.status !== 'ACTIVE') throw new Error('Таймер меняется только у идущей перебивки');
    const cap = new Date(Date.now() + s * 1000);
    const shorten = !!c.endsAt && c.endsAt > cap;
    return db.contest.update({
      where: { id: c.id },
      data: {
        config: { ...((c.config ?? {}) as object), extendSeconds: s } as Prisma.InputJsonValue,
        ...(shorten ? { endsAt: cap, timerVersion: { increment: 1 } } : {}),
      },
    });
  });
  await scheduleAuctionTimers(updated.id); // stale jobs of the old version no-op
  await contestEvent(updated.id, 'auction.timer_changed', { seconds: s });
  return updated;
}

/** Chat admins: `.таймер 2м` in the chat with a running «Перебивка». */
export async function handleTimerCommand(api: TelegramApi, bot: TelegramBot, msg: TgMessage): Promise<boolean> {
  const cmd = parseTimerCommand(msg.text);
  if (cmd === null) return false;
  const reply = (text: string) =>
    api.sendMessage(msg.chat.id, text, { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } }).catch(() => undefined);
  const contest = await prisma.contest.findFirst({
    where: { botId: bot.id, type: 'STARS_AUCTION', status: 'ACTIVE', targetChatTgId: BigInt(msg.chat.id) },
    orderBy: { startedAt: 'desc' },
  });
  if (!contest) return void (await reply('В этом чате сейчас нет перебивки.')), true;
  if (!(await isChatAdmin(api, msg))) return void (await reply('Менять таймер могут только администраторы чата.')), true;
  const current = auctionConfig(contest).extendSeconds;
  if (cmd === 'show') return void (await reply(`Таймер после каждой ставки: <b>${formatTimer(current)}</b>\nИзменить: <code>.таймер 2м</code> (от 15 сек до 60 мин)`)), true;
  if (cmd === 'invalid') return void (await reply('Не понял время. Пример: <code>.таймер 2м</code>, <code>.таймер 90с</code> — от 15 сек до 60 мин.')), true;
  try {
    await setAuctionTimer(contest.id, cmd);
    await reply(`Таймер: <b>${formatTimer(cmd)}</b> после каждой ставки${cmd < current ? '. Текущий отсчёт тоже сокращён.' : '.'}`);
  } catch (e) {
    await reply((e as Error).message);
  }
  return true;
}

const DM_CHOICES = [60, 120, 180, 300];

/** `/timer` in a private chat: the organizer's running «Перебивка», with one-tap buttons. */
export async function handleTimerPrivate(api: TelegramApi, bot: TelegramBot, msg: TgMessage): Promise<boolean> {
  const cmd = parseTimerCommand(msg.text);
  if (cmd === null || !msg.from) return false;
  const contest = await prisma.contest.findFirst({
    where: { botId: bot.id, type: 'STARS_AUCTION', status: 'ACTIVE', owner: { telegramId: BigInt(msg.from.id) } },
    orderBy: { startedAt: 'desc' },
  });
  if (!contest) return void (await api.sendMessage(msg.chat.id, 'У вас сейчас нет идущей перебивки.')), true;
  if (cmd === 'invalid') return void (await api.sendMessage(msg.chat.id, 'Не понял время. Пример: <code>/timer 2м</code> — от 15 сек до 60 мин.')), true;
  if (typeof cmd === 'number') {
    await setAuctionTimer(contest.id, cmd);
    return void (await api.sendMessage(msg.chat.id, `«${escapeHtml(contest.title)}»: таймер <b>${formatTimer(cmd)}</b> после каждой ставки.`)), true;
  }
  await api.sendMessage(msg.chat.id, `«${escapeHtml(contest.title)}»\nТаймер после каждой ставки: <b>${formatTimer(auctionConfig(contest).extendSeconds)}</b>`, {
    reply_markup: { inline_keyboard: [DM_CHOICES.map((sec) => ({ text: formatTimer(sec), callback_data: `atimer:${contest.id}:${sec}` }))] },
  });
  return true;
}

/** Buttons under `/timer`. Only the contest's organizer may press them. */
export async function handleTimerCallback(data: string, fromTgId: number, answer: (text: string) => Promise<unknown>) {
  const [, contestId, sec] = data.split(':');
  const contest = contestId ? await prisma.contest.findUnique({ where: { id: contestId }, include: { owner: true } }) : null;
  if (!contest || String(contest.owner.telegramId) !== String(fromTgId)) return answer('Таймер меняет организатор конкурса');
  try {
    await setAuctionTimer(contest.id, Number(sec));
    return answer(`Таймер: ${formatTimer(Number(sec))}`);
  } catch (e) {
    return answer((e as Error).message);
  }
}

/** New end time for an auction whose timer ran out while the bot was down, or null if it didn't. */
export function endAfterDowntime(endsAt: Date | null, extendSeconds: number, now = Date.now()): Date | null {
  if (!endsAt || endsAt.getTime() > now + 5000) return null;
  return new Date(now + extendSeconds * 1000);
}

/**
 * Worker start, before any queue runs: a hosting outage must not hand the prize to whoever led when
 * it began. Auctions that «ended» while the bot was down get a full timer again, and the chat is told.
 * Paid messages sent meanwhile arrive from Telegram right after and keep competing as usual.
 */
export async function resumeAuctionsAfterDowntime() {
  const running = await prisma.contest.findMany({ where: { type: 'STARS_AUCTION', status: 'ACTIVE', endsAt: { not: null } }, include: { bot: true } });
  let resumed = 0;
  for (const c of running) {
    const cfg = auctionConfig(c);
    const end = endAfterDowntime(c.endsAt, cfg.extendSeconds);
    if (!end) continue;
    await prisma.contest.update({ where: { id: c.id }, data: { endsAt: end, timerVersion: { increment: 1 } } });
    await contestEvent(c.id, 'auction.resumed_after_downtime', { previousEndsAt: c.endsAt });
    resumed++;
    if (c.targetChatTgId) {
      await apiForBot(c.bot)
        .sendMessage(c.targetChatTgId, `<b>Бот снова на связи</b> после сбоя хостинга.\nПеребивка продолжается: лидер ${escapeHtml(c.leaderName ?? '—')}, до конца ${formatTimer(cfg.extendSeconds)}.`)
        .catch(() => undefined);
    }
  }
  return resumed;
}
