import { randomInt } from 'node:crypto';
import type { Contest, TelegramBot, TemplateKey } from '@prisma/client';
import { sha256 } from '../../lib/crypto.js';
import { prisma } from '../../lib/prisma.js';
import { securePick } from '../../lib/rng.js';
import type { TelegramApi } from '../../telegram/client.js';
import { sendTemplate } from '../../telegram/messenger.js';
import type { TgMessage } from '../../telegram/types.js';
import { mention, type TemplateVars } from '../../templates/render.js';
import { prizeTitle } from '../contests/lifecycle.js';
import { createDeliveriesForDraw } from '../gifts/delivery.js';
import { isChatAdmin } from '../chats/access.js';
import { threadOf } from '../sms/service.js';
import { awardInstantWinner } from '../winners/engine.js';
import type { Candidate } from '../winners/select.js';

export interface ActivityConfig {
  minLength: number;
  minIntervalSec: number;
  ignoreDuplicates: boolean;
  countAdmins: boolean;
  ignoreOwner: boolean;
  // MESSAGE_GIVEAWAY triggers
  trigger: 'every_n_random' | 'every_n_author' | 'first_message' | 'threshold' | 'chance';
  everyMessages: number;
  threshold: number;
  windowMinutes: number;
  chancePercent: number; // chance mode: probability per counted message, e.g. 0.9
  dailyLimit: number; // chance mode: max prizes per day
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
) {
  const res = await awardInstantWinner(contest.id, candidate, reason);
  if (!res) return null;
  const prize = res.winner.prizeId ? await prisma.contestPrize.findUnique({ where: { id: res.winner.prizeId } }) : null;
  const owner = await prisma.user.findUnique({ where: { id: contest.ownerId } });
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
      owner_username: owner?.username ? `@${owner.username}` : owner?.firstName ?? '',
      contest_name: contest.title,
      chat_name: msg.chat.title,
      ...extra,
    },
    { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } },
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

    const prev = await prisma.contestParticipant.findUnique({ where: { contestId_tgUserId: { contestId: contest.id, tgUserId } } });
    if (spamReason(cfg, text, prev)) continue;
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

    switch (cfg.trigger) {
      case 'chance': {
        if (!rollChance(cfg.chancePercent)) break;
        const today = await prisma.contestWinner.count({
          where: { contestId: contest.id, status: 'ACTIVE', createdAt: { gte: startOfDay(new Date(), cfg.tzOffsetMinutes) } },
        });
        if (today >= cfg.dailyLimit) break;
        await awardWithReply(api, contest, self, 'chance', msg, 'CHANCE_WIN', {
          chance: String(cfg.chancePercent).replace('.', ','),
          remaining_slots: cfg.dailyLimit - today - 1,
        });
        break;
      }
      case 'first_message':
        if (messageCounter === 1) await awardWithReply(api, contest, self, 'first_message', msg);
        break;
      case 'threshold':
        if (participant.score === cfg.threshold) await awardWithReply(api, contest, self, 'threshold', msg);
        break;
      case 'every_n_author':
        if (messageCounter % cfg.everyMessages === 0) await awardWithReply(api, contest, self, 'every_n_author', msg);
        break;
      case 'every_n_random':
      default:
        if (messageCounter % cfg.everyMessages === 0) {
          const since = new Date(Date.now() - cfg.windowMinutes * 60_000);
          const active = await prisma.contestParticipant.findMany({ where: { contestId: contest.id, lastMessageAt: { gte: since }, isEligible: true } });
          const already = new Set((await prisma.contestWinner.findMany({ where: { contestId: contest.id, status: 'ACTIVE' } })).map((w) => String(w.tgUserId)));
          const [pick] = securePick(active.filter((a) => !already.has(String(a.tgUserId))), 1);
          if (pick) {
            await awardWithReply(
              api,
              contest,
              { tgUserId: pick.tgUserId, username: pick.username, firstName: pick.firstName, participantId: pick.id, score: pick.score },
              'every_n_random',
              msg,
              'CHANCE_WIN',
              { chance: (100 / Math.max(1, active.length)).toFixed(1).replace('.', ','), remaining_slots: Math.max(0, contest.winnersCount - contest.drawsCount - 1) },
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
