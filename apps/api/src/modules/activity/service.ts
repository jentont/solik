import { randomInt } from 'node:crypto';
import type { Contest, TelegramBot, TemplateKey } from '@prisma/client';
import { sha256 } from '../../lib/crypto.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { guardAllows } from '../guard/service.js';
import { securePick } from '../../lib/rng.js';
import type { TelegramApi } from '../../telegram/client.js';
import { sendTemplate } from '../../telegram/messenger.js';
import type { TgMessage } from '../../telegram/types.js';
import { mention, type TemplateVars } from '../../templates/render.js';
import { prizeTitle, winFrom } from '../contests/lifecycle.js';
import { createDeliveriesForDraw } from '../gifts/delivery.js';
import { isChatAdmin } from '../chats/access.js';
import { threadOf } from '../sms/service.js';
import { awardInstantWinner, type InstantOptions } from '../winners/engine.js';
import type { Candidate } from '../winners/select.js';

export interface ActivityConfig {
  minLength: number;
  minIntervalSec: number;
  ignoreDuplicates: boolean;
  countAdmins: boolean;
  ignoreOwner: boolean;
  // MESSAGE_GIVEAWAY triggers
  trigger: 'every_n_random' | 'every_n_author' | 'every_range' | 'first_message' | 'threshold' | 'chance';
  // every_range: the next gift drops after a random number of messages between rangeMin and rangeMax
  rangeMin: number;
  rangeMax: number;
  // Stars the gifts may cost per window (0 = no limit)
  starsLimit: number;
  starsLimitWindow: 'hour' | 'day';
  everyMessages: number;
  threshold: number;
  windowMinutes: number;
  chancePercent: number; // chance mode: probability per counted message, e.g. 0.9
  dailyLimit: number; // chance mode: max prizes per day for the whole chat
  // only messages paid with Stars (chats with paid messages enabled) count
  paidOnly: boolean;
  minPaidStars: number;
  // chance grows with the price: a message paid N× the minimum gets N× the chance (capped at 100 %)
  starsBoost: boolean;
  // prizes one person may win per window; 0 = unlimited
  perUserLimit: number;
  perUserWindow: 'hour' | 'day' | 'contest';
  // pick prizes by their weight (ContestPrize.weight) instead of in order
  weightedPrizes: boolean;
  tzOffsetMinutes: number; // day boundary for dailyLimit (default MSK)
}

export function activityConfig(c: Pick<Contest, 'config'>): ActivityConfig {
  const cfg = (c.config ?? {}) as Partial<ActivityConfig>;
  return {
    minLength: cfg.minLength ?? 3,
    minIntervalSec: cfg.minIntervalSec ?? 3,
    ignoreDuplicates: cfg.ignoreDuplicates ?? true,
    countAdmins: cfg.countAdmins ?? false,
    ignoreOwner: cfg.ignoreOwner ?? true,
    trigger: cfg.trigger ?? 'every_n_random',
    everyMessages: Math.max(2, cfg.everyMessages ?? 100),
    threshold: cfg.threshold ?? 50,
    windowMinutes: cfg.windowMinutes ?? 60,
    chancePercent: Math.min(100, Math.max(0.001, Number(cfg.chancePercent ?? 1))),
    dailyLimit: Math.max(1, cfg.dailyLimit ?? 100),
    paidOnly: Boolean(cfg.paidOnly ?? false),
    minPaidStars: Math.max(1, Number(cfg.minPaidStars ?? 1)),
    starsBoost: Boolean(cfg.starsBoost ?? false),
    perUserLimit: Math.max(0, Number(cfg.perUserLimit ?? 1)),
    perUserWindow: cfg.perUserWindow === 'hour' || cfg.perUserWindow === 'day' ? cfg.perUserWindow : 'contest',
    weightedPrizes: Boolean(cfg.weightedPrizes ?? false),
    rangeMin: Math.max(1, Number(cfg.rangeMin ?? 10)),
    rangeMax: Math.max(Math.max(1, Number(cfg.rangeMin ?? 10)), Number(cfg.rangeMax ?? 35)),
    starsLimit: Math.max(0, Number(cfg.starsLimit ?? 0)),
    starsLimitWindow: cfg.starsLimitWindow === 'day' ? 'day' : 'hour',
    tzOffsetMinutes: cfg.tzOffsetMinutes ?? 180,
  };
}

/** Anti-spam filter. Returns the reason a message is not counted, or null. */
export function spamReason(
  cfg: Pick<ActivityConfig, 'minLength' | 'minIntervalSec' | 'ignoreDuplicates'>,
  text: string,
  prev: { lastMessageAt: Date | null; lastTextHash: string | null } | null,
  now = Date.now(),
): string | null {
  if (text.trim().length < cfg.minLength) return 'too_short';
  if (prev?.lastMessageAt && now - prev.lastMessageAt.getTime() < cfg.minIntervalSec * 1000) return 'rate_limited';
  if (cfg.ignoreDuplicates && prev?.lastTextHash && prev.lastTextHash === sha256(text.trim().toLowerCase())) return 'duplicate';
  return null;
}

/** Secure roll: true with probability percent/100 (resolution 1e-6). */
export function rollChance(percent: number): boolean {
  return randomInt(1_000_000) < Math.round(percent * 10_000);
}

/** Chance for one message: base chance, multiplied by how many «minimum prices» were paid. */
export function messageChance(cfg: Pick<ActivityConfig, 'chancePercent' | 'starsBoost' | 'minPaidStars'>, paidStars: number): number {
  if (!cfg.starsBoost || paidStars <= 0) return cfg.chancePercent;
  return Math.min(100, cfg.chancePercent * Math.max(1, paidStars / cfg.minPaidStars));
}

/** Start of the per-user limit window. */
export function perUserSince(cfg: Pick<ActivityConfig, 'perUserWindow' | 'tzOffsetMinutes'>, now = new Date()): Date | null {
  if (cfg.perUserWindow === 'hour') return new Date(now.getTime() - 3600_000);
  if (cfg.perUserWindow === 'day') return startOfDay(now, cfg.tzOffsetMinutes);
  return null;
}

export function startOfDay(now: Date, tzOffsetMinutes: number): Date {
  const shifted = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - tzOffsetMinutes * 60_000);
}

/**
 * Awards an instant prize and announces it as a reply to the winning message
 * (like «🎉 Поздравляю! Ты выиграл … от @owner. Подарок отправлен.»), then queues delivery.
 */
export async function awardWithReply(
  api: TelegramApi,
  contest: Contest,
  candidate: Candidate,
  reason: string,
  msg: TgMessage,
  key: TemplateKey = 'INSTANT_WIN',
  extra: TemplateVars = {},
  opts: InstantOptions = {},
) {
  // frozen by the anti-spam guard, or the balance would cross the reserve
  if (!(await guardAllows(contest))) return null;
  const res = await awardInstantWinner(contest.id, candidate, reason, opts);
  if (!res) return null;
  const prize = res.winner.prizeId ? await prisma.contestPrize.findUnique({ where: { id: res.winner.prizeId } }) : null;
  const owner = await prisma.user.findUnique({ where: { id: contest.ownerId } });
  // the picture picked for this contest (only the owner's own uploads)
  const winMediaId = ((contest.config ?? {}) as Record<string, unknown>).winMediaId;
  const winMedia = typeof winMediaId === 'string' ? await prisma.mediaFile.findFirst({ where: { id: winMediaId, ownerId: contest.ownerId } }) : null;
  const who = mention({ id: candidate.tgUserId, username: candidate.username, first_name: candidate.firstName });
  await sendTemplate(
    api,
    { ownerId: contest.ownerId, botId: contest.botId },
    msg.chat.id,
    key,
    {
      username: who,
      winner_username: who,
      first_name: candidate.firstName,
      user_id: String(candidate.tgUserId),
      prize_name: prize?.title ?? prizeTitle(await prisma.contestPrize.findMany({ where: { contestId: contest.id } })),
      gift_name: prize?.title,
      // «от кого» in the congratulation: an admin picked in the contest settings, else the contest owner
      owner_username: winFrom(contest) ?? (owner?.username ? `@${owner.username}` : owner?.firstName ?? ''),
      contest_name: contest.title,
      chat_name: msg.chat.title,
      ...extra,
    },
    { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } },
    winMedia,
  ).catch(() => undefined);
  await createDeliveriesForDraw(contest.id, res.drawNumber);
  return res;
}

/** Feeds a group message into FIRST_COMMENT / MESSAGE_GIVEAWAY / ACTIVITY contests. */
export async function handleChatActivity(api: TelegramApi, bot: TelegramBot, msg: TgMessage) {
  if (!msg.from || msg.is_automatic_forward || msg.sender_chat || msg.from.is_bot) return;
  const chatTgId = BigInt(msg.chat.id);
  const contests = await prisma.contest.findMany({
    where: {
      botId: bot.id,
      status: 'ACTIVE',
      type: { in: ['FIRST_COMMENT', 'MESSAGE_GIVEAWAY', 'ACTIVITY'] },
      OR: [{ targetChatTgId: chatTgId }, { channel: { discussionChat: { chatId: chatTgId } } }],
    },
    include: { bot: { include: { owner: true } } },
  });
  if (!contests.length) return;
  const text = msg.text ?? msg.caption ?? '';
  const from = msg.from;
  const tgUserId = BigInt(from.id);

  for (const contest of contests) {
    const cfg = activityConfig(contest);
    const owner = await prisma.user.findUnique({ where: { id: contest.ownerId } });
    if (cfg.ignoreOwner && owner && owner.telegramId === tgUserId) continue;
    if (!cfg.countAdmins && (await isChatAdmin(api, msg))) continue;

    if (contest.type === 'FIRST_COMMENT') {
      // Only comments under the selected post count
      if (!contest.threadMessageId || threadOf(msg) !== contest.threadMessageId) continue;
      if (!text.trim() && !msg.photo && !msg.animation) continue;
      const p = await prisma.contestParticipant.upsert({
        where: { contestId_tgUserId: { contestId: contest.id, tgUserId } },
        create: { contestId: contest.id, tgUserId, username: from.username, firstName: from.first_name, position: 1, score: 1, lastMessageAt: new Date() },
        update: {},
      });
      await awardWithReply(api, contest, { tgUserId, username: from.username, firstName: from.first_name, participantId: p.id, position: 1, score: 1 }, 'first_comment', msg);
      continue;
    }

    const paid = msg.paid_star_count ?? 0;
    const paidRound = contest.type === 'MESSAGE_GIVEAWAY' && cfg.paidOnly;
    if (paidRound && paid < cfg.minPaidStars) continue; // free (or too cheap) messages don't take part
    const prev = await prisma.contestParticipant.findUnique({ where: { contestId_tgUserId: { contestId: contest.id, tgUserId } } });
    // a paid message is its own anti-spam: no length / interval / duplicate filter
    if (!paidRound && spamReason(cfg, text, prev)) continue;
    const textHash = sha256(text.trim().toLowerCase());
    const participant = await prisma.contestParticipant.upsert({
      where: { contestId_tgUserId: { contestId: contest.id, tgUserId } },
      create: { contestId: contest.id, tgUserId, username: from.username, firstName: from.first_name, score: 1, lastMessageAt: new Date(), lastTextHash: textHash },
      update: { score: { increment: 1 }, lastMessageAt: new Date(), lastTextHash: textHash, username: from.username },
    });
    if (contest.type !== 'MESSAGE_GIVEAWAY') continue;

    const { messageCounter } = await prisma.contest.update({
      where: { id: contest.id },
      data: { messageCounter: { increment: 1 } },
      select: { messageCounter: true },
    });
    const self: Candidate = { tgUserId, username: from.username, firstName: from.first_name, participantId: participant.id, score: participant.score };
    const since = perUserSince(cfg);
    const award: InstantOptions = {
      perUserLimit: cfg.perUserLimit,
      perUserSince: since,
      weighted: cfg.weightedPrizes,
      ...(cfg.starsLimit > 0
        ? { starsLimit: cfg.starsLimit, starsSince: cfg.starsLimitWindow === 'day' ? startOfDay(new Date(), cfg.tzOffsetMinutes) : new Date(Date.now() - 3600_000) }
        : {}),
    };

    switch (cfg.trigger) {
      case 'chance': {
        const chance = messageChance(cfg, paid);
        if (!rollChance(chance)) break;
        const today = await prisma.contestWinner.count({
          where: { contestId: contest.id, status: 'ACTIVE', createdAt: { gte: startOfDay(new Date(), cfg.tzOffsetMinutes) } },
        });
        if (today >= cfg.dailyLimit) break;
        await awardWithReply(
          api,
          contest,
          self,
          'chance',
          msg,
          'CHANCE_WIN',
          { chance: String(Math.round(chance * 1000) / 1000).replace('.', ','), remaining_slots: cfg.dailyLimit - today - 1 },
          award,
        );
        break;
      }
      case 'every_range': {
        // the drop point is hidden: a random count in [rangeMin, rangeMax] after the previous drop
        const key = `drop:next:${contest.id}`;
        let next = Number(await redis().get(key));
        if (!next || next < messageCounter) {
          next = messageCounter - 1 + randomInt(cfg.rangeMin, cfg.rangeMax + 1);
          await redis().set(key, String(next), 'EX', 30 * 24 * 3600);
        }
        if (messageCounter >= next) {
          await redis().set(key, String(messageCounter + randomInt(cfg.rangeMin, cfg.rangeMax + 1)), 'EX', 30 * 24 * 3600);
          await awardWithReply(api, contest, self, 'every_range', msg, 'INSTANT_WIN', {}, award);
        }
        break;
      }
      case 'first_message':
        if (messageCounter === 1) await awardWithReply(api, contest, self, 'first_message', msg, 'INSTANT_WIN', {}, award);
        break;
      case 'threshold':
        if (participant.score === cfg.threshold) await awardWithReply(api, contest, self, 'threshold', msg, 'INSTANT_WIN', {}, award);
        break;
      case 'every_n_author':
        if (messageCounter % cfg.everyMessages === 0) await awardWithReply(api, contest, self, 'every_n_author', msg, 'INSTANT_WIN', {}, award);
        break;
      case 'every_n_random':
      default:
        if (messageCounter % cfg.everyMessages === 0) {
          const since = new Date(Date.now() - cfg.windowMinutes * 60_000);
          const active = await prisma.contestParticipant.findMany({ where: { contestId: contest.id, lastMessageAt: { gte: since }, isEligible: true } });
          // people who already reached their win limit in the current window can't be picked
          const wins = await prisma.contestWinner.groupBy({
            by: ['tgUserId'],
            where: { contestId: contest.id, status: 'ACTIVE', ...(since ? { createdAt: { gte: since } } : {}) },
            _count: true,
          });
          const capped = new Set(wins.filter((w) => cfg.perUserLimit > 0 && w._count >= cfg.perUserLimit).map((w) => String(w.tgUserId)));
          const [pick] = securePick(active.filter((a) => !capped.has(String(a.tgUserId))), 1);
          if (pick) {
            await awardWithReply(
              api,
              contest,
              { tgUserId: pick.tgUserId, username: pick.username, firstName: pick.firstName, participantId: pick.id, score: pick.score },
              'every_n_random',
              msg,
              'CHANCE_WIN',
              { chance: (100 / Math.max(1, active.length)).toFixed(1).replace('.', ','), remaining_slots: Math.max(0, contest.winnersCount - contest.drawsCount - 1) },
              award,
            );
          }
        }
    }
  }
}

export async function leaderboard(contestId: string, take = 20) {
  const rows = await prisma.contestParticipant.findMany({ where: { contestId }, orderBy: { score: 'desc' }, take });
  return rows.map((r, i) => ({ rank: i + 1, tgUserId: r.tgUserId.toString(), name: mention({ id: r.tgUserId, username: r.username, first_name: r.firstName }), score: r.score }));
}
