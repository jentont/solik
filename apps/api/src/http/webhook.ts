import type { FastifyInstance } from 'fastify';
import { Prisma, type TelegramBot } from '@prisma/client';
import { safeEqual } from '../lib/crypto.js';
import { prisma } from '../lib/prisma.js';
import { updateType, type TgUpdate } from '../telegram/types.js';
import { dispatchUpdate } from '../bot/dispatcher.js';

const botCache = new Map<string, { bot: TelegramBot; at: number }>();

async function loadBot(id: string) {
  const hit = botCache.get(id);
  if (hit && Date.now() - hit.at < 30_000) return hit.bot;
  const bot = await prisma.telegramBot.findUnique({ where: { id } });
  if (bot) botCache.set(id, { bot, at: Date.now() });
  return bot;
}

export async function webhookRoutes(app: FastifyInstance) {
  app.post<{ Params: { botId: string } }>('/webhook/:botId', { config: { rateLimit: false } }, async (req, reply) => {
    const bot = await loadBot(req.params.botId);
    const header = String(req.headers['x-telegram-bot-api-secret-token'] ?? '');
    // Verification: the secret is set per bot via setWebhook(secret_token)
    if (!bot || !header || !safeEqual(header, bot.webhookSecret)) return reply.code(401).send({ ok: false });

    const update = req.body as TgUpdate;
    if (!update || typeof update.update_id !== 'number') return reply.code(400).send({ ok: false });

    // Idempotency: Telegram retries deliveries; (bot, update_id) is processed once.
    let eventId: string;
    try {
      const ev = await prisma.webhookEvent.create({
        data: { botId: bot.id, botKey: bot.id, updateId: BigInt(update.update_id), type: updateType(update) },
      });
      eventId = ev.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return reply.send({ ok: true, duplicate: true });
      throw e;
    }

    try {
      await dispatchUpdate(bot, update);
      await prisma.webhookEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
      if (!bot.lastActivityAt || Date.now() - bot.lastActivityAt.getTime() > 60_000) {
        await prisma.telegramBot.update({ where: { id: bot.id }, data: { lastActivityAt: new Date() } });
        botCache.delete(bot.id);
      }
    } catch (e) {
      req.log.error({ err: e, botId: bot.id, updateId: update.update_id }, 'update processing failed');
      await prisma.webhookEvent.update({ where: { id: eventId }, data: { error: String((e as Error).message).slice(0, 1000) } }).catch(() => undefined);
    }
    // Always 200: a failing update must not block the bot's update stream.
    return reply.send({ ok: true });
  });
}

export function invalidateWebhookBot(id: string) {
  botCache.delete(id);
}
