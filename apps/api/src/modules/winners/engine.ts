import { randomInt } from 'node:crypto';
import type { Contest, ContestPrize, ContestWinner } from '@prisma/client';
import { audit, contestEvent } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { drawSeed } from '../../lib/rng.js';
import { selectWinners, type Candidate, type SelectConfig } from './select.js';

export interface DrawResult {
  contest: Contest;
  winners: (ContestWinner & { prize: ContestPrize | null })[];
  drawNumber: number;
}

async function loadCandidates(contest: Contest): Promise<Candidate[]> {
  if (contest.type === 'SMS_COUNTER') {
    const counter = await prisma.smsCounter.findUnique({ where: { contestId: contest.id } });
    if (!counter) return [];
    const rows = await prisma.smsCounterParticipant.findMany({ where: { counterId: counter.id }, orderBy: { position: 'asc' } });
    return rows.map((r) => ({ tgUserId: r.tgUserId, username: r.username, firstName: r.firstName, position: r.position, score: 1 }));
  }
  const rows = await prisma.contestParticipant.findMany({
    where: { contestId: contest.id, isEligible: true },
    orderBy: [{ position: 'asc' }, { joinedAt: 'asc' }],
  });
  return rows.map((r) => ({
    tgUserId: r.tgUserId,
    username: r.username,
    firstName: r.firstName,
    participantId: r.id,
    position: r.position,
    score: r.score,
  }));
}

/** Expands prizes into a per-place list. */
export function prizeSlots(prizes: ContestPrize[], winnersCount: number): (ContestPrize | null)[] {
  const sorted = [...prizes].sort((a, b) => (a.place ?? 999) - (b.place ?? 999) || (a.position ?? 999) - (b.position ?? 999));
  const slots: (ContestPrize | null)[] = [];
  for (const p of sorted) for (let i = 0; i < Math.max(1, p.quantity); i++) slots.push(p);
  while (slots.length < winnersCount) slots.push(slots.length ? slots[slots.length - 1]! : null);
  return slots;
}

/** Weighted random pick (crypto RNG). Items with weight <= 0 never win. */
export function pickWeighted<T>(items: T[], weightOf: (t: T) => number): T | null {
  const total = items.reduce((s, t) => s + Math.max(0, weightOf(t)), 0);
  if (total <= 0) return null;
  let r = randomInt(total);
  for (const t of items) {
    r -= Math.max(0, weightOf(t));
    if (r < 0) return t;
  }
  return null;
}

export interface InstantOptions {
  // how many prizes one person may win: within `perUserSince` (null = whole contest)
  perUserLimit?: number;
  perUserSince?: Date | null;
  // pick the prize by ContestPrize.weight among prizes still in stock instead of by place
  weighted?: boolean;
}

/**
 * Instant win for streaming modes (message giveaway triggers, first comment).
 * Each award is its own draw; stops once `winnersCount` awards were made
 * (or, in weighted mode, when every prize is out of stock).
 */
export async function awardInstantWinner(contestId: string, c: Candidate, reason: string, opts: InstantOptions = {}) {
  const res = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ status: string; drawsCount: number; winnersCount: number }[]>`
      SELECT status, "drawsCount", "winnersCount" FROM "Contest" WHERE id = ${contestId} FOR UPDATE`;
    if (!locked || locked.status !== 'ACTIVE' || locked.drawsCount >= locked.winnersCount) return null;
    const limit = opts.perUserLimit ?? 1; // 0 = unlimited
    if (limit > 0) {
      const won = await tx.contestWinner.count({
        where: { contestId, tgUserId: c.tgUserId, status: 'ACTIVE', ...(opts.perUserSince ? { createdAt: { gte: opts.perUserSince } } : {}) },
      });
      if (won >= limit) return null;
    }
    const prizes = await tx.contestPrize.findMany({ where: { contestId } });
    const drawNumber = locked.drawsCount + 1;
    let prize: ContestPrize | null;
    let outOfStock = false;
    if (opts.weighted) {
      const given = await tx.contestWinner.groupBy({ by: ['prizeId'], where: { contestId, status: 'ACTIVE', prizeId: { not: null } }, _count: true });
      const used = new Map(given.map((g) => [g.prizeId, g._count]));
      const inStock = prizes.filter((p) => (used.get(p.id) ?? 0) < Math.max(1, p.quantity));
      prize = pickWeighted(inStock, (p) => p.weight ?? 0);
      if (!prize) return null; // nothing left to drop
      outOfStock = inStock.filter((p) => (p.weight ?? 0) > 0).every((p) => (used.get(p.id) ?? 0) + (p.id === prize!.id ? 1 : 0) >= Math.max(1, p.quantity));
    } else {
      prize = prizeSlots(prizes, locked.winnersCount)[drawNumber - 1] ?? null;
    }
    const winner = await tx.contestWinner.create({
      data: {
        contestId,
        participantId: c.participantId,
        tgUserId: c.tgUserId,
        username: c.username,
        firstName: c.firstName,
        place: drawNumber,
        drawNumber,
        prizeId: prize?.id,
        seed: drawSeed(),
      },
    });
    const finished = drawNumber >= locked.winnersCount || outOfStock;
    await tx.contest.update({
      where: { id: contestId },
      data: { drawsCount: drawNumber, ...(finished ? { status: 'FINISHED', finishedAt: new Date() } : {}) },
    });
    return { winner, drawNumber, finished };
  });
  if (res) await contestEvent(contestId, 'winner.instant', { reason, tgUserId: c.tgUserId, drawNumber: res.drawNumber });
  return res;
}

/**
 * Draws winners exactly once per draw. Concurrency-safe: the contest row is locked
 * and the status transition is conditional, so two parallel calls cannot both draw.
 * `reroll: true` marks the current winners REROLLED (they are excluded) and draws again.
 */
export async function drawWinners(contestId: string, opts: { actorId?: string | null; reroll?: boolean } = {}): Promise<DrawResult> {
  const contest = await prisma.contest.findUnique({ where: { id: contestId }, include: { prizes: true } });
  if (!contest) throw notFound('Конкурс не найден');
  let candidates = await loadCandidates(contest);
  // «Перебивка»: the winner is the last leader when the timer ran out
  if (contest.type === 'STARS_AUCTION') candidates = candidates.filter((c) => contest.leaderTgId != null && c.tgUserId === contest.leaderTgId);

  const result = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ status: string; drawsCount: number }[]>`
      SELECT status, "drawsCount" FROM "Contest" WHERE id = ${contestId} FOR UPDATE`;
    if (!locked) throw notFound('Конкурс не найден');

    let excludeTgIds: bigint[] = [];
    if (opts.reroll) {
      if (locked.status !== 'FINISHED') throw conflict('Повторный розыгрыш доступен только для завершенного конкурса');
      const prev = await tx.contestWinner.findMany({ where: { contestId, status: 'ACTIVE' } });
      excludeTgIds = prev.map((w) => w.tgUserId);
      await tx.contestWinner.updateMany({ where: { contestId, status: 'ACTIVE' }, data: { status: 'REROLLED' } });
      // previously rerolled winners stay excluded too
      const older = await tx.contestWinner.findMany({ where: { contestId, status: 'REROLLED' }, select: { tgUserId: true } });
      excludeTgIds.push(...older.map((w) => w.tgUserId));
    } else if (!['ACTIVE', 'SCHEDULED', 'DRAWING'].includes(locked.status)) {
      throw conflict('Победители уже определены. Используйте повторный розыгрыш.');
    }

    const cfg = (contest.config ?? {}) as SelectConfig & { activityMode?: SelectConfig['activityMode'] };
    const smsPositions =
      contest.type === 'SMS_COUNTER' ? contest.prizes.filter((p) => p.position).map((p) => p.position!).sort((a, b) => a - b) : [];
    const picked = selectWinners(contest.type, candidates, contest.winnersCount, {
      ...cfg,
      prizePositions: smsPositions.length ? smsPositions : undefined,
      excludeTgIds,
    });

    const drawNumber = locked.drawsCount + 1;
    const seed = drawSeed();
    const slots = prizeSlots(contest.prizes, picked.length);
    const winners = [];
    for (let i = 0; i < picked.length; i++) {
      const c = picked[i]!;
      // SMS prize queue: prize bound to the participant position
      const prize =
        contest.type === 'SMS_COUNTER' && smsPositions.length
          ? contest.prizes.find((p) => p.position === c.position) ?? null
          : slots[i] ?? null;
      winners.push(
        await tx.contestWinner.create({
          data: {
            contestId,
            participantId: c.participantId,
            tgUserId: c.tgUserId,
            username: c.username,
            firstName: c.firstName,
            place: i + 1,
            drawNumber,
            prizeId: prize?.id,
            seed,
          },
          include: { prize: true },
        }),
      );
    }

    const updated = await tx.contest.update({
      where: { id: contestId },
      data: { status: 'FINISHED', finishedAt: new Date(), drawsCount: drawNumber },
    });
    return { contest: updated, winners, drawNumber };
  });

  await contestEvent(contestId, opts.reroll ? 'winners.rerolled' : 'winners.drawn', {
    drawNumber: result.drawNumber,
    winners: result.winners.map((w) => ({ tgUserId: w.tgUserId, place: w.place })),
    candidates: candidates.length,
  });
  await audit(opts.reroll ? 'contest.reroll' : 'contest.draw', {
    actorId: opts.actorId,
    entity: 'Contest',
    entityId: contestId,
    meta: { drawNumber: result.drawNumber, winners: result.winners.length },
  });
  return result;
}
