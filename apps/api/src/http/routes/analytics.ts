import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { requireAuth, uid } from '../auth.js';
import { parse } from '../validate.js';

const filterSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  botId: z.string().optional(),
  chatId: z.string().optional(),
  contestId: z.string().optional(),
  prizeKind: z.enum(['GIFT', 'STARS', 'NFT', 'PREMIUM', 'CUSTOM']).optional(),
});

export async function analyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/dashboard', async (req) => {
    const ownerId = uid(req);
    const [bots, active, participants, sms, winners, delivered, stars, recent, chats] = await Promise.all([
      prisma.telegramBot.count({ where: { ownerId } }),
      prisma.contest.count({ where: { ownerId, status: 'ACTIVE' } }),
      prisma.contestParticipant.count({ where: { contest: { ownerId } } }),
      prisma.smsCounterParticipant.count({ where: { counter: { contest: { ownerId } } } }),
      prisma.contestWinner.count({ where: { contest: { ownerId }, status: 'ACTIVE' } }),
      prisma.giftDelivery.count({ where: { contest: { ownerId }, status: 'DELIVERED' } }),
      prisma.starsTransaction.aggregate({ where: { contest: { ownerId }, status: 'APPLIED' }, _sum: { amount: true } }),
      prisma.contestEvent.findMany({ where: { contest: { ownerId } }, include: { contest: { select: { id: true, title: true } } }, orderBy: { createdAt: 'desc' }, take: 15 }),
      prisma.telegramChat.count({ where: { OR: [{ ownerId }, { bot: { ownerId } }] } }),
    ]);
    return {
      bots,
      chats,
      activeContests: active,
      participants: participants + sms,
      winners,
      giftsDelivered: delivered,
      stars: stars._sum.amount ?? 0,
      recent,
    };
  });

  app.get('/api/analytics', async (req) => {
    const ownerId = uid(req);
    const f = parse(filterSchema, req.query);
    const to = f.to ?? new Date();
    const from = f.from ?? new Date(to.getTime() - 30 * 86_400_000);
    const contestWhere: Prisma.ContestWhereInput = {
      ownerId,
      createdAt: { gte: from, lte: to },
      ...(f.botId ? { botId: f.botId } : {}),
      ...(f.chatId ? { chatId: f.chatId } : {}),
      ...(f.contestId ? { id: f.contestId } : {}),
      ...(f.prizeKind ? { prizes: { some: { kind: f.prizeKind } } } : {}),
    };
    const contests = await prisma.contest.findMany({
      where: contestWhere,
      select: {
        id: true,
        type: true,
        createdAt: true,
        botId: true,
        bot: { select: { username: true } },
        chat: { select: { title: true } },
        channel: { select: { title: true } },
        _count: { select: { participants: true, winners: true } },
        smsCounter: { select: { count: true } },
      },
    });
    const ids = contests.map((c) => c.id);
    const [delivered, stars] = await Promise.all([
      prisma.giftDelivery.count({ where: { contestId: { in: ids }, status: 'DELIVERED' } }),
      prisma.starsTransaction.aggregate({ where: { contestId: { in: ids }, status: 'APPLIED' }, _sum: { amount: true } }),
    ]);
    // Daily series via SQL (owner-scoped, parameterized)
    const series = ids.length
      ? await prisma.$queryRaw<{ day: Date; participants: bigint; winners: bigint }[]>`
          SELECT d.day,
            (SELECT COUNT(*) FROM "ContestParticipant" p WHERE p."contestId" IN (${Prisma.join(ids)}) AND date_trunc('day', p."joinedAt") = d.day) AS participants,
            (SELECT COUNT(*) FROM "ContestWinner" w WHERE w."contestId" IN (${Prisma.join(ids)}) AND date_trunc('day', w."createdAt") = d.day) AS winners
          FROM generate_series(date_trunc('day', ${from}::timestamp), date_trunc('day', ${to}::timestamp), interval '1 day') AS d(day)
          ORDER BY d.day`
      : [];
    const participantsOf = (c: (typeof contests)[number]) => c._count.participants + (c.smsCounter?.count ?? 0);
    const group = <K extends string>(key: (c: (typeof contests)[number]) => K) => {
      const m = new Map<K, { contests: number; participants: number; winners: number }>();
      for (const c of contests) {
        const k = key(c);
        const v = m.get(k) ?? { contests: 0, participants: 0, winners: 0 };
        v.contests++;
        v.participants += participantsOf(c);
        v.winners += c._count.winners;
        m.set(k, v);
      }
      return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.contests - a.contests);
    };
    return {
      range: { from, to },
      totals: {
        contests: contests.length,
        participants: contests.reduce((s, c) => s + participantsOf(c), 0),
        winners: contests.reduce((s, c) => s + c._count.winners, 0),
        giftsDelivered: delivered,
        stars: stars._sum.amount ?? 0,
      },
      series: series.map((s) => ({ day: s.day, participants: Number(s.participants), winners: Number(s.winners) })),
      byType: group((c) => c.type),
      byChat: group((c) => c.chat?.title ?? c.channel?.title ?? '—'),
      byBot: group((c) => '@' + c.bot.username),
    };
  });
}
