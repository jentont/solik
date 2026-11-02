import type { TelegramBot } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { forbidden, limitReached } from '../../lib/errors.js';

/**
 * Access model:
 *  - FREE: use the platform bot in your own chats. All contest features free at launch.
 *  - WHITE-LABEL: own bot, paid per bot (WhiteLabelPlan, 100 Stars/month by default).
 * Limits per plan are stored in WhiteLabelPlan.limits / settings so they can be changed from the admin panel.
 */
export interface PlanLimits {
  maxActiveContests: number;
  maxChats: number;
  aiGenerationsPerDay: number;
}

const FREE_LIMITS: PlanLimits = { maxActiveContests: 1000, maxChats: 1000, aiGenerationsPerDay: 50 };

export const DEFAULT_WHITE_LABEL_PLAN = {
  code: 'white-label-monthly',
  name: 'White-Label',
  priceStars: 100,
  periodDays: 30,
  graceDays: 3,
};

export async function ensureDefaultPlan() {
  const existing = await prisma.whiteLabelPlan.findFirst({ where: { isDefault: true } });
  if (existing) return existing;
  return prisma.whiteLabelPlan.upsert({
    where: { code: DEFAULT_WHITE_LABEL_PLAN.code },
    create: { ...DEFAULT_WHITE_LABEL_PLAN, isDefault: true, limits: {} },
    update: { isDefault: true },
  });
}

export async function freeLimits(): Promise<PlanLimits> {
  const s = await prisma.platformSetting.findUnique({ where: { key: 'free_limits' } });
  return { ...FREE_LIMITS, ...((s?.value as Partial<PlanLimits>) ?? {}) };
}

/** A bot can host new contests only while active (white-label: subscription valid). */
export function assertBotUsable(bot: Pick<TelegramBot, 'status' | 'isPlatform'>) {
  if (bot.status === 'SUSPENDED') throw forbidden('Бот приостановлен администрацией платформы');
  if (bot.status === 'SUBSCRIPTION_EXPIRED') throw limitReached('Подписка на бота истекла — продлите её, чтобы создавать новые конкурсы');
  if (bot.status === 'INVALID_TOKEN') throw forbidden('Токен бота недействителен — переподключите бота');
  if (bot.status === 'DISABLED') throw forbidden('Бот отключен');
}

export async function assertContestLimit(ownerId: string) {
  const limits = await freeLimits();
  const active = await prisma.contest.count({ where: { ownerId, status: { in: ['ACTIVE', 'SCHEDULED'] } } });
  if (active >= limits.maxActiveContests) throw limitReached(`Достигнут лимит активных конкурсов (${limits.maxActiveContests})`);
}
