import { Worker, type Job } from 'bullmq';
import { env } from './config/env.js';
import { createRedis } from './lib/redis.js';
import { prisma } from './lib/prisma.js';
import { closeQueues, jobId, queue, QUEUES, type AIJobPayload, type AuctionTimerJob, type BroadcastJob, type ContestJob, type GiftDeliveryJob, type NotificationJob } from './queues/index.js';
import { sendRich } from './telegram/messenger.js';
import { apiForBotId } from './telegram/registry.js';
import { TelegramError } from './telegram/client.js';
import { registerPlatformBot } from './modules/bots/service.js';
import { finishContest, scheduleContestEnd, startContest } from './modules/contests/lifecycle.js';
import { handleAuctionTimer } from './modules/auction/service.js';
import { scheduleAuctionTimers } from './modules/auction/timers.js';
import { processDelivery } from './modules/gifts/delivery.js';
import { runImageJob, runTextJob } from './modules/ai/jobs.js';
import { resumeAuctionsAfterDowntime } from './modules/auction/timerCommand.js';
import { enqueuePending, RateLimited, sendBroadcastRecipient } from './modules/broadcasts/service.js';
import { runSubscriptionMaintenance } from './modules/subscriptions/service.js';
import { verifyGiftsWithTelegram } from './modules/gifts/catalog.js';

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

const connection = createRedis();
const workers: Worker[] = [];
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

function worker<T>(name: string, fn: (job: Job<T>, w: Worker) => Promise<unknown>, opts: Partial<ConstructorParameters<typeof Worker>[2]> = {}) {
  const w: Worker = new Worker(name, (job) => fn(job as Job<T>, w), { connection, concurrency: 5, ...opts });
  w.on('failed', (job, err) => log(`[${name}] job ${job?.id} failed:`, err.message));
  workers.push(w);
  return w;
}

/**
 * After a restart: everything with a deadline is re-derived from PostgreSQL.
 * Job ids are deterministic, so already-queued jobs are not duplicated.
 */
async function recover() {
  const scheduled = await prisma.contest.findMany({ where: { status: 'SCHEDULED' } });
  for (const c of scheduled) {
    await queue(QUEUES.contestStart).add('start', { contestId: c.id }, { delay: Math.max(0, (c.startsAt?.getTime() ?? Date.now()) - Date.now()), jobId: jobId('start', c.id, c.startsAt?.getTime() ?? 0) });
  }
  const active = await prisma.contest.findMany({ where: { status: 'ACTIVE', endsAt: { not: null } } });
  for (const c of active) {
    if (c.type === 'STARS_AUCTION') await scheduleAuctionTimers(c.id);
    else await scheduleContestEnd(c.id, c.endsAt!);
  }
  const broadcasts = await prisma.broadcast.findMany({ where: { status: 'RUNNING' } });
  for (const b of broadcasts) await enqueuePending(b.id);
  const deliveries = await prisma.giftDelivery.findMany({ where: { status: 'PENDING' }, select: { id: true } });
  for (const d of deliveries) await queue(QUEUES.giftDelivery).add('deliver', { deliveryId: d.id }, { jobId: `delivery__${d.id}__recover` });
  log(`recovered: ${scheduled.length} scheduled, ${active.length} timed, ${broadcasts.length} broadcasts, ${deliveries.length} deliveries`);
}

async function main() {
  await registerPlatformBot();
  // before any worker can fire a stale «end» job
  const resumed = await resumeAuctionsAfterDowntime().catch(() => 0);
  if (resumed) log(`resumed ${resumed} auctions after downtime`);

  worker<ContestJob>(QUEUES.contestStart, async (job) => {
    const c = await prisma.contest.findUnique({ where: { id: job.data.contestId } });
    if (c?.status === 'SCHEDULED') await startContest(c.id, null, { force: true });
  });

  worker<ContestJob>(QUEUES.contestEnd, async (job) => {
    const c = await prisma.contest.findUnique({ where: { id: job.data.contestId } });
    if (!c || c.status !== 'ACTIVE' || !c.endsAt) return;
    if (c.endsAt.getTime() > Date.now() + 1000) return scheduleContestEnd(c.id, c.endsAt); // end date moved
    await finishContest(c.id);
  });

  worker<ContestJob>(QUEUES.winner, async (job) => finishContest(job.data.contestId));

  worker<AuctionTimerJob>(QUEUES.auctionTimer, async (job) => handleAuctionTimer(job.data), { concurrency: 20 });

  worker<GiftDeliveryJob>(QUEUES.giftDelivery, async (job) => processDelivery(job.data.deliveryId), { concurrency: 3 });

  // Ordered chat notifications (SMS registrations etc). Per-chat limit is ~20 msg/min in groups.
  worker<NotificationJob>(
    QUEUES.notification,
    async (job, w) => {
      const api = await apiForBotId(job.data.botId);
      const media = job.data.mediaId ? await prisma.mediaFile.findUnique({ where: { id: job.data.mediaId } }) : null;
      try {
        await sendRich(api, job.data.botId, BigInt(job.data.chatId), { html: job.data.html, media, buttons: job.data.buttons?.map((b) => [b]) }, {
          ...(job.data.replyTo ? { reply_parameters: { message_id: job.data.replyTo, allow_sending_without_reply: true } } : {}),
          ...(job.data.threadId ? { message_thread_id: job.data.threadId } : {}),
        });
      } catch (e) {
        if (e instanceof TelegramError && e.isRateLimit) {
          await w.rateLimit((e.retryAfter ?? 3) * 1000);
          throw Worker.RateLimitError();
        }
        if (e instanceof TelegramError && (e.code === 400 || e.code === 403)) return; // not retryable
        throw e;
      }
    },
    { concurrency: 1, limiter: { max: 25, duration: 1000 } },
  );

  worker<AIJobPayload>(QUEUES.aiContent, async (job) => runTextJob(job.data.jobId), { concurrency: 4 });
  worker<AIJobPayload>(QUEUES.aiImage, async (job) => runImageJob(job.data.jobId), { concurrency: 2 });

  // Broadcasts: global limiter below Telegram's ~30 msg/s; 429 pauses the whole queue for retry_after.
  worker<BroadcastJob>(
    QUEUES.broadcast,
    async (job, w) => {
      try {
        await sendBroadcastRecipient(job.data.recipientId, job.attemptsMade, job.opts.attempts ?? 4);
      } catch (e) {
        if (e instanceof RateLimited) {
          await w.rateLimit(e.retryAfterMs);
          throw Worker.RateLimitError();
        }
        throw e;
      }
    },
    { concurrency: 5, limiter: { max: 20, duration: 1000 } },
  );

  worker(QUEUES.subscriptions, async () => runSubscriptionMaintenance());
  worker(QUEUES.analytics, async (job) => {
    if (job.name === 'verify-gifts') return verifyGiftsWithTelegram();
    if (job.name === 'cleanup') {
      // webhook idempotency keys are only needed for a few days
      await prisma.webhookEvent.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - 7 * 86_400_000) }, error: null } });
    }
  });

  // repeatable maintenance jobs
  await queue(QUEUES.subscriptions).upsertJobScheduler('subscription-maintenance', { every: 10 * 60_000 }, { name: 'maintenance' });
  await queue(QUEUES.analytics).upsertJobScheduler('verify-gifts', { every: 6 * 3600_000 }, { name: 'verify-gifts' });
  await queue(QUEUES.analytics).upsertJobScheduler('cleanup', { every: 24 * 3600_000 }, { name: 'cleanup' });

  await recover();
  log(`SOLIK worker started (${workers.length} queues, env=${env.NODE_ENV})`);

  const shutdown = async () => {
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
