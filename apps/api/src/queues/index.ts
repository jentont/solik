import { Queue, type JobsOptions } from 'bullmq';
import { createRedis } from '../lib/redis.js';

export const QUEUES = {
  contestStart: 'ContestStartQueue',
  contestEnd: 'ContestEndQueue',
  winner: 'WinnerQueue',
  giftDelivery: 'GiftDeliveryQueue',
  notification: 'TelegramNotificationQueue',
  aiContent: 'AIContentQueue',
  aiImage: 'AIImageQueue',
  smsCounter: 'SmsCounterQueue',
  analytics: 'AnalyticsQueue',
  auctionTimer: 'AuctionTimerQueue',
  broadcast: 'BroadcastQueue',
  subscriptions: 'SubscriptionQueue',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

const queues = new Map<string, Queue>();
let connection: ReturnType<typeof createRedis> | null = null;

export function queue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    connection ??= createRedis();
    q = new Queue(name, { connection, defaultJobOptions });
    queues.set(name, q);
  }
  return q;
}

/** BullMQ job ids may not contain ':' */
export const jobId = (...parts: (string | number)[]) => parts.join('__');

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  await connection?.quit();
}

// ── Job payloads ──
export interface NotificationJob {
  botId: string;
  chatId: string; // bigint as string
  html: string;
  replyTo?: number;
  threadId?: number;
  mediaId?: string;
  buttons?: { text: string; url?: string; callback?: string }[];
}
export interface ContestJob {
  contestId: string;
}
export interface AuctionTimerJob {
  contestId: string;
  version: number;
  kind: 'checkpoint' | 'countdown' | 'end';
  secondsLeft: number;
}
export interface GiftDeliveryJob {
  deliveryId: string;
}
export interface AIJobPayload {
  jobId: string;
}
export interface BroadcastJob {
  recipientId: string;
}
