import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * End-to-end flow against a real PostgreSQL + Redis:
 *   webhook (idempotent) → `.sms 3` → 3 comments → `.sms winner` → winner stored, delivery created.
 * Telegram Bot API is mocked at the fetch level.
 *
 * Run:  TEST_DATABASE_URL=postgresql://... REDIS_URL=redis://... npx prisma migrate deploy && npm test
 */
const DB = process.env.TEST_DATABASE_URL;
const run = DB ? describe : describe.skip;

run('SMS Counter end-to-end', () => {
  let app: FastifyInstance;
  let prisma: typeof import('../src/lib/prisma.js').prisma;
  const sent: { method: string; body: any }[] = [];
  const CHAT = -1001234567890;
  let botId = '';
  let secret = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const method = String(url).split('/').pop()!;
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {};
      sent.push({ method, body });
      const result =
        method === 'getMe' ? { id: 999, is_bot: true, first_name: 'Test', username: 'test_bot' } :
        method === 'getChatMember' ? { status: 'administrator', user: { id: body.user_id } } :
        method === 'sendMessage' ? { message_id: Math.floor(Math.random() * 1e6), chat: { id: body.chat_id }, date: 0 } :
        true;
      return new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
    });
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { buildServer } = await import('../src/server.js');
    const { encrypt, randomToken } = await import('../src/lib/crypto.js');
    app = await buildServer();
    const owner = await prisma.user.upsert({ where: { telegramId: 111n }, create: { telegramId: 111n, username: 'owner' }, update: {} });
    secret = randomToken();
    const bot = await prisma.telegramBot.upsert({
      where: { telegramId: 999n },
      create: { telegramId: 999n, ownerId: owner.id, username: 'test_bot', name: 'Test', tokenEncrypted: encrypt('999:' + 'a'.repeat(35)), webhookSecret: secret },
      update: { webhookSecret: secret, status: 'ACTIVE' },
    });
    botId = bot.id;
    await prisma.smsCounter.deleteMany({ where: { botId } });
    await prisma.contest.deleteMany({ where: { botId } });
    await prisma.webhookEvent.deleteMany({ where: { botId } });
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllGlobals();
  });

  let updateId = 1000;
  const post = (message: object, id = ++updateId) =>
    app.inject({ method: 'POST', url: `/webhook/${botId}`, headers: { 'x-telegram-bot-api-secret-token': secret }, payload: { update_id: id, message } });
  const msg = (from: number, text: string, mid: number) => ({ message_id: mid, date: 0, chat: { id: CHAT, type: 'supergroup', title: 'Chat' }, from: { id: from, is_bot: false, first_name: `U${from}` }, text });

  it('rejects webhook with a wrong secret', async () => {
    const r = await app.inject({ method: 'POST', url: `/webhook/${botId}`, headers: { 'x-telegram-bot-api-secret-token': 'nope' }, payload: { update_id: 1 } });
    expect(r.statusCode).toBe(401);
  });

  it('runs .sms 3 → registrations → winner', async () => {
    await post(msg(111, '.sms 3', 1));
    const counter = await prisma.smsCounter.findFirstOrThrow({ where: { botId, status: 'ACTIVE' } });
    expect(counter.target).toBe(3);

    await post(msg(201, 'первый!', 2));
    await post(msg(201, 'ещё раз', 3)); // same user — ignored
    await post(msg(202, 'я', 4));
    // a duplicate delivery of the same update must not register twice
    await post(msg(203, 'тут', 5), 5000);
    await post(msg(203, 'тут', 5), 5000);
    await post(msg(204, 'поздно', 6)); // counter already full

    const after = await prisma.smsCounter.findUniqueOrThrow({ where: { id: counter.id }, include: { participants: { orderBy: { position: 'asc' } } } });
    expect(after.count).toBe(3);
    expect(after.status).toBe('FILLED');
    expect(after.participants.map((p) => Number(p.tgUserId))).toEqual([201, 202, 203]);

    await post(msg(111, '.sms winner', 7));
    const winners = await prisma.contestWinner.findMany({ where: { contestId: counter.contestId } });
    expect(winners).toHaveLength(1);
    expect([201, 202, 203]).toContain(Number(winners[0]!.tgUserId));
    const contest = await prisma.contest.findUniqueOrThrow({ where: { id: counter.contestId } });
    expect(contest.status).toBe('FINISHED');
  });

  it('non-admins cannot start a counter', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const method = String(url).split('/').pop()!;
      const result = method === 'getChatMember' ? { status: 'member', user: { id: 1 } } : { message_id: 1, chat: { id: CHAT }, date: 0 };
      return new Response(JSON.stringify({ ok: true, result }));
    });
    const before = await prisma.smsCounter.count({ where: { botId } });
    await post(msg(777, '.sms 5', 50));
    expect(await prisma.smsCounter.count({ where: { botId } })).toBe(before);
  });
});
