import type { Contest, TelegramBot } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import type { TelegramApi } from '../../telegram/client.js';
import type { TgMessage } from '../../telegram/types.js';
import { awardWithReply } from '../activity/service.js';

/**
 * Конкурс «777»: participants send the 🎰 slot machine (Telegram dice). The value is generated
 * by Telegram's servers, so it can't be faked by the client. Value 64 = three sevens.
 * Forwarded dice are ignored (otherwise someone could forward an old 777).
 */
export const SLOT_JACKPOT = 64;

export interface DiceConfig {
  emoji: string; // 🎰 by default; 🎲 🎯 🏀 ⚽ 🎳 also supported by Telegram
  winValue: number;
  cooldownSec: number; // per-user spin rate limit
  maxSpinsPerUser: number; // 0 = unlimited
}

export function diceConfig(c: Pick<Contest, 'config'>): DiceConfig {
  const cfg = (c.config ?? {}) as Partial<DiceConfig>;
  return {
    emoji: cfg.emoji ?? '🎰',
    winValue: cfg.winValue ?? SLOT_JACKPOT,
    cooldownSec: Math.max(0, cfg.cooldownSec ?? 0),
    maxSpinsPerUser: Math.max(0, cfg.maxSpinsPerUser ?? 0),
  };
}

export function isJackpot(msg: Pick<TgMessage, 'dice' | 'forward_origin'>, cfg: Pick<DiceConfig, 'emoji' | 'winValue'>): boolean {
  if (!msg.dice || msg.forward_origin) return false;
  return msg.dice.emoji === cfg.emoji && msg.dice.value === cfg.winValue;
}

export async function handleDice(api: TelegramApi, bot: TelegramBot, msg: TgMessage): Promise<boolean> {
  if (!msg.dice || !msg.from || msg.from.is_bot || msg.forward_origin) return false;
  const contest = await prisma.contest.findFirst({
    where: { botId: bot.id, type: 'DICE_777', status: 'ACTIVE', targetChatTgId: BigInt(msg.chat.id) },
  });
  if (!contest) return false;
  const cfg = diceConfig(contest);
  if (msg.dice.emoji !== cfg.emoji) return true;
  const tgUserId = BigInt(msg.from.id);

  if (cfg.cooldownSec > 0) {
    const ok = await redis().set(`dice:cd:${contest.id}:${msg.from.id}`, '1', 'EX', cfg.cooldownSec, 'NX');
    if (ok === null) return true; // spin during cooldown doesn't count
  }
  const p = await prisma.contestParticipant.upsert({
    where: { contestId_tgUserId: { contestId: contest.id, tgUserId } },
    create: { contestId: contest.id, tgUserId, username: msg.from.username, firstName: msg.from.first_name, score: 1, lastMessageAt: new Date() },
    update: { score: { increment: 1 }, lastMessageAt: new Date(), username: msg.from.username },
  });
  if (cfg.maxSpinsPerUser && p.score > cfg.maxSpinsPerUser) return true;
  if (!isJackpot(msg, cfg)) return true;

  await awardWithReply(
    api,
    contest,
    { tgUserId, username: msg.from.username, firstName: msg.from.first_name, participantId: p.id, score: p.score },
    'dice_777',
    msg,
    'DICE_WIN',
  );
  return true;
}
