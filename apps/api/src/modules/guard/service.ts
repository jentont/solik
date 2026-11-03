import type { Contest, Prisma, TelegramBot } from '@prisma/client';
import { contestEvent } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import type { TelegramApi } from '../../telegram/client.js';
import { apiForBot } from '../../telegram/registry.js';
import { escapeHtml } from '../../templates/render.js';
import { enqueueDelivery } from '../gifts/delivery.js';
import { prizeStars } from '../winners/engine.js';

/**
 * Safety net for instant-win contests:
 * - freeze: too many prizes in a short window (a bug, a raid, a misconfigured chance) stops the drops
 *   and asks the owner in a DM whether to go on;
 * - reserve: never let the paying balance (own bot / Business account) drop below a floor.
 */
export interface GuardConfig {
  guardMaxWins: number; // 0 = off
  guardWindowMin: number;
  starsReserve: number; // 0 = off
  frozen: boolean;
  resumedAt: string | null;
}

export function guardConfig(c: Pick<Contest, 'config'>): GuardConfig {
  const cfg = (c.config ?? {}) as Record<string, unknown>;
  return {
    guardMaxWins: Math.max(0, Number(cfg.guardMaxWins ?? 10)),
    guardWindowMin: Math.max(1, Number(cfg.guardWindowMin ?? 10)),
    starsReserve: Math.max(0, Number(cfg.starsReserve ?? 0)),
    frozen: Boolean(cfg.frozen),
    resumedAt: typeof cfg.resumedAt === 'string' ? cfg.resumedAt : null,
  };
}

/** Wins counted against the freeze limit: inside the window and after the last «continue». */
export function guardSince(g: Pick<GuardConfig, 'guardWindowMin' | 'resumedAt'>, now = Date.now()): Date {
  const windowStart = now - g.guardWindowMin * 60_000;
  const resumed = g.resumedAt ? new Date(g.resumedAt).getTime() : 0;
  return new Date(Math.max(windowStart, resumed));
}

async function mergeConfig(contestId: string, patch: Record<string, unknown>) {
  const c = await prisma.contest.findUniqueOrThrow({ where: { id: contestId }, select: { config: true } });
  await prisma.contest.update({ where: { id: contestId }, data: { config: { ...((c.config ?? {}) as object), ...patch } as Prisma.InputJsonValue } });
}

async function dmOwner(contest: Contest & { bot: TelegramBot }, html: string, buttons?: { text: string; callback_data: string }[][]) {
  const owner = await prisma.user.findUnique({ where: { id: contest.ownerId } });
  if (!owner) return;
  await apiForBot(contest.bot)
    .sendMessage(owner.telegramId, html, buttons ? { reply_markup: { inline_keyboard: buttons } } : {})
    .catch(() => undefined); // owner may not have started this bot
}

/** Paying balance for gifts in this contest: the own bot's Stars, or the owner's Business account for the platform bot. */
async function payingBalance(contest: Contest & { bot: TelegramBot }): Promise<number | null> {
  const api = apiForBot(contest.bot);
  if (!contest.bot.isPlatform) return (await api.getMyStarBalance().catch(() => null))?.amount ?? null;
  const conn = await prisma.telegramBusinessConnection.findFirst({
    where: { botId: contest.botId, ownerId: contest.ownerId, isEnabled: true, canTransferStars: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (!conn) return null;
  return (await api.getBusinessAccountStarBalance(conn.connectionId).catch(() => null))?.amount ?? null;
}

/**
 * Called before every instant win. Returns false when the drop must not happen
 * (contest frozen, freeze limit just reached, or the reserve would be crossed).
 */
export async function guardAllows(contest: Contest): Promise<boolean> {
  const g = guardConfig(contest);
  if (g.frozen) return false;
  const full = await prisma.contest.findUniqueOrThrow({ where: { id: contest.id }, include: { bot: true, prizes: { include: { gift: { select: { starCost: true } } } } } });

  if (g.guardMaxWins > 0) {
    const recent = await prisma.contestWinner.count({ where: { contestId: contest.id, status: 'ACTIVE', createdAt: { gte: guardSince(g) } } });
    if (recent >= g.guardMaxWins) {
      await freeze(full, `за ${g.guardWindowMin} мин. выпало уже ${recent} подарков`);
      return false;
    }
  }

  if (g.starsReserve > 0) {
    const maxCost = Math.max(0, ...full.prizes.map((p) => prizeStars(p)));
    const balance = await payingBalance(full);
    if (balance !== null && balance - maxCost < g.starsReserve) {
      // one reminder an hour is enough
      if (await redis().set(`guard:reserve:${contest.id}`, '1', 'EX', 3600, 'NX')) {
        await dmOwner(
          full,
          `<b>Подарки на паузе: дошли до неснижаемого остатка</b>\n\nКонкурс «${escapeHtml(full.title)}»\nНа балансе ${balance} Stars, остаток не ниже ${g.starsReserve}, подарок стоит до ${maxCost}.\n\nПополните Stars — подарки снова начнут падать сами.`,
        );
      }
      return false;
    }
  }
  return true;
}

async function freeze(contest: Contest & { bot: TelegramBot }, reason: string) {
  await mergeConfig(contest.id, { frozen: true, frozenAt: new Date().toISOString(), frozenReason: reason });
  await contestEvent(contest.id, 'guard.frozen', { reason });
  await dmOwner(
    contest,
    `<b>Конкурс заморожен — проверьте, всё ли в порядке</b>\n\n«${escapeHtml(contest.title)}»: ${escapeHtml(reason)}. Так бывает при спаме, рейде или слишком большом шансе.\n\nПока вы не ответите, подарки не выпадают. Уже выигранные подарки ждут вашего решения.`,
    [
      [{ text: 'Всё нормально, продолжить', callback_data: `guard:go:${contest.id}` }],
      [{ text: 'Остановить конкурс', callback_data: `guard:stop:${contest.id}` }],
    ],
  );
}

/** «Продолжить»: unfreeze, restart the window and send the prizes held during the freeze. */
export async function resumeContest(contestId: string) {
  await mergeConfig(contestId, { frozen: false, resumedAt: new Date().toISOString() });
  const held = await prisma.giftDelivery.findMany({ where: { contestId, status: 'PENDING' }, select: { id: true } });
  for (const d of held) await enqueueDelivery(d.id);
  await contestEvent(contestId, 'guard.resumed', { released: held.length });
  return held.length;
}

export function isFrozen(contest: Pick<Contest, 'config'> | null | undefined) {
  return !!contest && guardConfig(contest).frozen;
}

/** Buttons under the freeze DM. Only the contest owner may answer. */
export async function handleGuardCallback(api: TelegramApi, data: string, fromId: number, answer: (text: string, alert?: boolean) => Promise<unknown>) {
  const [, action, contestId] = data.split(':');
  const contest = contestId ? await prisma.contest.findUnique({ where: { id: contestId }, include: { owner: true } }) : null;
  if (!contest || String(contest.owner.telegramId) !== String(fromId)) return answer('Это решение принимает владелец конкурса', true);
  if (action === 'go') {
    const n = await resumeContest(contest.id);
    return answer(n ? `Продолжаем. Отправляю ${n} отложенных подарков` : 'Продолжаем', true);
  }
  if (action === 'stop') {
    const { cancelContest } = await import('../contests/lifecycle.js');
    await cancelContest(contest.id, contest.ownerId).catch(() => undefined);
    await prisma.giftDelivery.updateMany({ where: { contestId: contest.id, status: 'PENDING' }, data: { status: 'MANUAL_REQUIRED', note: 'Конкурс остановлен защитой — решите вручную, выдавать ли приз' } });
    return answer('Конкурс остановлен. Отложенные подарки — в разделе «Подарки → Выдача»', true);
  }
  void api;
  return answer('');
}
