import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';

// Integration tests of the HTTP layer that don't need a database:
// authentication, CSRF and webhook verification guards.
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildServer();
});
afterAll(async () => {
  await app.close();
});

const token = () =>
  new SignJWT({ role: 'USER', tg: '1' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('u1')
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));

describe('API guards', () => {
  it('health is public', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.json()).toEqual({ ok: true });
  });

  it.each(['/api/bots', '/api/contests', '/api/dashboard', '/api/admin/stats', '/api/gifts/catalog', '/api/billing'])('%s requires auth', async (url) => {
    const r = await app.inject({ method: 'GET', url });
    expect(r.statusCode).toBe(401);
  });

  it('rejects forged JWT', async () => {
    const forged = await new SignJWT({ role: 'OWNER', tg: '1' }).setProtectedHeader({ alg: 'HS256' }).setSubject('x').sign(new TextEncoder().encode('wrong-secret-wrong-secret-wrong-secret'));
    const r = await app.inject({ method: 'GET', url: '/api/admin/stats', headers: { authorization: `Bearer ${forged}` } });
    expect(r.statusCode).toBe(401);
  });

  it('cookie-authenticated mutation without CSRF header is rejected', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/bots', cookies: { solik_session: await token() }, payload: { token: 'x'.repeat(30) } });
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toMatch(/CSRF/);
  });

  it('rejects invalid initData', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/telegram-webapp', payload: { initData: 'user=%7B%7D&auth_date=1&hash=deadbeef' } });
    expect(r.statusCode).toBe(401);
  });

  it('validates request bodies', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/telegram-webapp', payload: { initData: 1 } });
    expect(r.statusCode).toBe(400);
  });

  it('media files require a valid signature', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/media/abc/file?sig=bad' });
    expect(r.statusCode).toBe(404);
  });
});
