import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env, isProd, platformOwnerIds } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import { forbidden, unauthorized } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { validateLoginWidget, validateWebAppInitData, type WebAppUser } from '../../telegram/initData.js';
import { issueSession, requireAuth, SESSION_COOKIE, uid } from '../auth.js';
import { parse } from '../validate.js';

async function upsertUser(u: WebAppUser) {
  const isOwner = platformOwnerIds.has(String(u.id));
  const user = await prisma.user.upsert({
    where: { telegramId: BigInt(u.id) },
    create: {
      telegramId: BigInt(u.id),
      username: u.username,
      firstName: u.first_name,
      lastName: u.last_name,
      photoUrl: u.photo_url,
      languageCode: u.language_code,
      role: isOwner ? 'OWNER' : 'USER',
      lastLoginAt: new Date(),
    },
    update: {
      username: u.username,
      firstName: u.first_name,
      lastName: u.last_name,
      photoUrl: u.photo_url,
      lastLoginAt: new Date(),
      ...(isOwner ? { role: 'OWNER' } : {}),
    },
  });
  if (user.isBlocked) throw forbidden('Аккаунт заблокирован');
  await prisma.subscription.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
  return user;
}

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  // Telegram Mini App
  app.post('/api/auth/telegram-webapp', strict, async (req, reply) => {
    const { initData } = parse(z.object({ initData: z.string().min(10).max(4096) }), req.body);
    let tgUser: WebAppUser;
    try {
      tgUser = validateWebAppInitData(initData, env.MAIN_BOT_TOKEN);
    } catch (e) {
      throw unauthorized(`Неверные данные Telegram: ${(e as Error).message}`);
    }
    const user = await upsertUser(tgUser);
    const token = await issueSession(user, reply);
    await audit('auth.login', { actorId: user.id, meta: { via: 'webapp' }, ip: req.ip });
    return { token, user: serializeUser(user) };
  });

  // Standalone web version — Telegram Login Widget
  app.post('/api/auth/telegram-login', strict, async (req, reply) => {
    const data = parse(z.record(z.union([z.string(), z.number()])), req.body);
    let tgUser: WebAppUser;
    try {
      tgUser = validateLoginWidget(data, env.MAIN_BOT_TOKEN);
    } catch (e) {
      throw unauthorized(`Неверные данные Telegram: ${(e as Error).message}`);
    }
    const user = await upsertUser(tgUser);
    const token = await issueSession(user, reply);
    await audit('auth.login', { actorId: user.id, meta: { via: 'widget' }, ip: req.ip });
    return { token, user: serializeUser(user) };
  });

  // Local development only (never in production)
  if (env.ALLOW_DEV_LOGIN && !isProd) {
    app.post('/api/auth/dev', async (req, reply) => {
      const { telegramId } = parse(z.object({ telegramId: z.coerce.number().int().positive() }), req.body);
      const user = await upsertUser({ id: telegramId, first_name: 'Dev' });
      return { token: await issueSession(user, reply), user: serializeUser(user) };
    });
  }

  // Public, non-secret runtime config for the web app (so the image needs no build-time variables)
  let botUsername: string | null = null;
  app.get('/api/config', async () => {
    if (!botUsername) {
      const { mainApi } = await import('../../telegram/registry.js');
      botUsername = (await mainApi.getMe().catch(() => null))?.username ?? null;
    }
    return { botUsername };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', { preHandler: requireAuth }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: uid(req) }, include: { subscription: true } });
    const { mainApi } = await import('../../telegram/registry.js');
    const me = await mainApi.getMe().catch(() => null);
    return { user: serializeUser(user), plan: user.subscription?.plan ?? 'FREE', platformBot: me ? { username: me.username } : null };
  });
}

export function serializeUser(u: { id: string; telegramId: bigint; username: string | null; firstName: string | null; photoUrl: string | null; role: string }) {
  return { id: u.id, telegramId: u.telegramId.toString(), username: u.username, firstName: u.firstName, photoUrl: u.photoUrl, role: u.role };
}
