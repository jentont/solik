import { prisma } from '../../lib/prisma.js';
import { jobId, queue, QUEUES, type AuctionTimerJob } from '../../queues/index.js';

export const CHECKPOINTS = [60, 30];

function warningsOf(config: unknown): number[] {
  const w = (config as { warnings?: unknown })?.warnings;
  return Array.isArray(w) ? w.map(Number).filter((n) => n > 10 && n < 3600) : CHECKPOINTS;
}
export const COUNTDOWN_FROM = 10;

/**
 * Timers live on the server as delayed BullMQ jobs keyed by (contest, timerVersion).
 * Every confirmed bid increments timerVersion, so stale jobs simply no-op.
 * After a restart `recoverTimers` reschedules from the DB (`endsAt` is the source of truth).
 */
export async function scheduleAuctionTimers(contestId: string) {
  const c = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!c || c.status !== 'ACTIVE' || !c.endsAt) return;
  const q = queue(QUEUES.auctionTimer);
  const now = Date.now();
  const end = c.endsAt.getTime();
  const add = (kind: AuctionTimerJob['kind'], secondsLeft: number) => {
    const at = end - secondsLeft * 1000;
    if (at < now - 500 && kind !== 'end') return;
    return q.add(kind, { contestId, version: c.timerVersion, kind, secondsLeft } satisfies AuctionTimerJob, {
      delay: Math.max(0, at - now),
      jobId: jobId('auction', contestId, c.timerVersion, kind, secondsLeft),
      attempts: kind === 'end' ? 10 : 1,
    });
  };
  await Promise.all([
    ...warningsOf(c.config).map((s) => add('checkpoint', s)),
    ...Array.from({ length: COUNTDOWN_FROM }, (_, i) => add('countdown', COUNTDOWN_FROM - i)),
    add('end', 0),
  ]);
}
