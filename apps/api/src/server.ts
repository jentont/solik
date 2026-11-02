import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { env, isProd } from './config/env.js';
import { AppError } from './lib/errors.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { mainApi, webhookUrl } from './telegram/registry.js';
import { registerPlatformBot } from './modules/bots/service.js';
import { ensureDefaultPlan } from './modules/subscriptions/plans.js';
import { setupMainBotMenu } from './bot/mainMenu.js';
import { webhookRoutes } from './http/webhook.js';
import { authRoutes } from './http/routes/auth.js';
import { botRoutes } from './http/routes/bots.js';
import { contestRoutes } from './http/routes/contests.js';
import { giftRoutes } from './http/routes/gifts.js';
import { contentRoutes } from './http/routes/content.js';
import { billingRoutes } from './http/routes/billing.js';
import { analyticsRoutes } from './http/routes/analytics.js';
import { adminRoutes } from './http/routes/admin.js';

// Telegram ids are BigInt in the DB; serialize them as strings in JSON.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

export async function buildServer() {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-telegram-bot-api-secret-token"]'] },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: [env.WEB_APP_URL, ...env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)],
    credentials: true,
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', redis: env.NODE_ENV === 'test' ? undefined : redis(), keyGenerator: (req) => req.user?.id ?? req.ip });
  await app.register(multipart, { limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: 'REQUEST_ERROR', message: e.message });
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'INTERNAL', message: isProd ? 'Внутренняя ошибка сервера' : e.message });
  });

  app.get('/health', async () => ({ ok: true }));
  await app.register(webhookRoutes);
  await app.register(authRoutes);
  await app.register(botRoutes);
  await app.register(contestRoutes);
  await app.register(giftRoutes);
  await app.register(contentRoutes);
  await app.register(billingRoutes);
  await app.register(analyticsRoutes);
  await app.register(adminRoutes);
  return app;
}

async function main() {
  const app = await buildServer();
  const platform = await registerPlatformBot();
  await ensureDefaultPlan();
  // Platform bot webhook + menu
  await mainApi.setWebhook(webhookUrl(platform.id), platform.webhookSecret).catch((e) => app.log.error({ err: e }, 'main bot setWebhook failed'));
  await setupMainBotMenu(mainApi).catch((e) => app.log.warn({ err: e }, 'menu setup failed'));
  await app.listen({ port: env.PORT, host: env.HOST });

  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
