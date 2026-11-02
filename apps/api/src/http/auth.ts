import type { FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import type { Role, User } from '@prisma/client';
import { env, isProd } from '../config/env.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

const secret = new TextEncoder().encode(env.JWT_SECRET);
export const SESSION_COOKIE = 'solik_session';

export interface AuthUser {
  id: string;
  telegramId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function issueSession(user: User, reply: FastifyReply) {
  const token = await new SignJWT({ role: user.role, tg: user.telegramId.toString() })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${env.SESSION_TTL_HOURS}h`)
    .sign(secret);
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: env.SESSION_TTL_HOURS * 3600,
  });
  // Also returned for the Telegram Mini App (embedded iframes may block cookies); the client keeps it in memory only.
  return token;
}

async function readToken(req: FastifyRequest): Promise<{ user: AuthUser; viaCookie: boolean } | null> {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const cookie = req.cookies?.[SESSION_COOKIE];
  const token = bearer ?? cookie;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return { user: { id: payload.sub!, telegramId: String(payload.tg), role: payload.role as Role }, viaCookie: !bearer };
  } catch {
    return null;
  }
}

/** preHandler: authenticated user. Role and block status are re-read from the DB. */
export async function requireAuth(req: FastifyRequest) {
  const t = await readToken(req);
  if (!t) throw unauthorized();
  // CSRF: cookie-authenticated mutations must carry a custom header (forces CORS preflight)
  if (t.viaCookie && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-solik-csrf'] !== '1') {
    throw forbidden('CSRF check failed');
  }
  const user = await prisma.user.findUnique({ where: { id: t.user.id }, select: { id: true, role: true, isBlocked: true, telegramId: true } });
  if (!user || user.isBlocked) throw unauthorized('Доступ заблокирован');
  req.user = { id: user.id, role: user.role, telegramId: user.telegramId.toString() };
}

export async function requireAdmin(req: FastifyRequest) {
  await requireAuth(req);
  if (req.user!.role === 'USER') throw forbidden('Доступно только администраторам платформы');
}

export async function requireOwner(req: FastifyRequest) {
  await requireAuth(req);
  if (req.user!.role !== 'OWNER') throw forbidden('Доступно только владельцу платформы');
}

export const uid = (req: FastifyRequest) => req.user!.id;
