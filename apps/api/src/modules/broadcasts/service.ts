import type { Broadcast, BroadcastMode, Prisma } from '@prisma/client';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { queue, QUEUES, type BroadcastJob } from '../../queues/index.js';
import { TelegramError } from '../../telegram/client.js';
import { sendRich, type TemplateButton } from '../../telegram/messenger.js';
import { apiForBot, getPlatformBotId } from '../../telegram/registry.js';
import { sanitizeTelegramHtml } from '../../templates/render.js';

export interface BroadcastFilters {
  botIds?: string[];
  ownerIds?: string[];
  onlyActiveBots?: boolean;
  onlyValidSubscription?: boolean;
  chatKinds?: ('GROUP' | 'SUPERGROUP' | 'DISCUSSION')[];
  // MAIN_BOT_USERS segments
  segment?: 'all' | 'active' | 'new' | 'with_subscription' | 'without_subscription' | 'wl_owners' | 'contest_creators' | 'inactive';
  inactiveDays?: number;
}

export interface Recipient {
  botId: string;
  chatTgId: bigint;
}

const DAY = 86_400_000;

/**
 * Builds the recipient list. Only chats where a SOLIK bot is connected and active, and only
 * users who started the bot themselves and haven't blocked it. Deduplicated by Telegram chat id:
 * a chat with several connected bots receives the message once (preferring `viaBotId`, then the platform bot).
 */
export async function buildRecipients(mode: BroadcastMode, f: BroadcastFilters, viaBotId?: string | null): Promise<Recipient[]> {
  const platformId = getPlatformBotId();
  if (mode === 'MAIN_BOT_USERS') {
    const now = Date.now();
    const where: Prisma.BotUserWhereInput = { botId: platformId, isBlocked: false };
    const users = await prisma.botUser.findMany({ where, select: { tgUserId: true, lastSeenAt: true, startedAt: true } });
    let ids = users;
    const seg = f.segment ?? 'all';
    if (seg === 'active') ids = ids.filter((u) => now - u.lastSeenAt.getTime() < 30 * DAY);
    if (seg === 'new') ids = ids.filter((u) => now - u.startedAt.getTime() < 7 * DAY);
    if (seg === 'inactive') ids = ids.filter((u) => now - u.lastSeenAt.getTime() > (f.inactiveDays ?? 30) * DAY);
    if (['with_subscription', 'without_subscription', 'wl_owners', 'contest_creators'].includes(seg)) {
      const tg = ids.map((u) => u.tgUserId);
      const accounts = await prisma.user.findMany({
        where: { telegramId: { in: tg } },
        select: {
          telegramId: true,
          botSubscriptions: { where: { status: { in: ['ACTIVE', 'CANCELLED', 'GRACE'] } }, select: { id: true } },
          bots: { select: { id: true } },
          _count: { select: { contests: true } },
        },
      });
      const test = (a: (typeof accounts)[number]) =>
        seg === 'wl_owners' ? a.bots.length > 0 : seg === 'contest_creators' ? a._count.contests > 0 : a.botSubscriptions.length > 0;
      const match = new Set(accounts.filter(test).map((a) => String(a.telegramId)));
      ids = ids.filter((u) => (seg === 'without_subscription' ? !match.has(String(u.tgUserId)) : match.has(String(u.tgUserId))));
    }
    return ids.map((u) => ({ botId: viaBotId ?? platformId, chatTgId: u.tgUserId }));
  }

  const botWhere: Prisma.TelegramBotWhereInput = {
    ...(mode === 'WHITE_LABEL_CHATS' ? { isPlatform: false } : {}),
    ...(mode === 'MAIN_BOT_CHATS' ? { isPlatform: true } : {}),
    ...(f.botIds?.length ? { id: { in: f.botIds } } : {}),
    ...(f.ownerIds?.length ? { ownerId: { in: f.ownerIds } } : {}),
    status: f.onlyActiveBots === false ? { notIn: ['SUSPENDED', 'INVALID_TOKEN'] } : 'ACTIVE',
    ...(f.onlyValidSubscription ? { OR: [{ isPlatform: true }, { subscription: { status: { in: ['ACTIVE', 'CANCELLED', 'GRACE'] } } }] } : {}),
  };
  const kinds = f.chatKinds ?? ['GROUP', 'SUPERGROUP', 'DISCUSSION'];
  const chats = await prisma.telegramChat.findMany({
    where: { status: 'ACTIVE', bot: botWhere },
    select: { chatId: true, botId: true, kind: true, linkedChannelChatId: true, bot: { select: { isPlatform: true } } },
  });
  const byChat = new Map<string, { botId: string; rank: number }>();
  for (const c of chats) {
    const kind = c.linkedChannelChatId ? 'DISCUSSION' : c.kind;
    if (!kinds.includes(kind)) continue;
    const rank = c.botId === viaBotId ? 0 : c.bot.isPlatform ? 1 : 2;
    const key = String(c.chatId);
    const prev = byChat.get(key);
    if (!prev || rank < prev.rank) byChat.set(key, { botId: c.botId, rank });
  }
  if (viaBotId) {
    // "send through a specific bot": only chats that bot is in
    return [...byChat.entries()].filter(([, v]) => v.botId === viaBotId).map(([chat, v]) => ({ botId: v.botId, chatTgId: BigInt(chat) }));
  }
  return [...byChat.entries()].map(([chat, v]) => ({ botId: v.botId, chatTgId: BigInt(chat) }));
}

export async function previewBroadcast(b: Pick<Broadcast, 'mode' | 'filters' | 'viaBotId'>) {
  const r = await buildRecipients(b.mode, b.filters as BroadcastFilters, b.viaBotId);
  return { recipients: r.length, chats: b.mode === 'MAIN_BOT_USERS' ? 0 : r.length, users: b.mode === 'MAIN_BOT_USERS' ? r.length : 0, bots: new Set(r.map((x) => x.botId)).size };
}

export async function startBroadcast(id: string, actorId: string) {
  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id } });
  if (b.status !== 'DRAFT') throw conflict('Рассылка уже запущена');
  const recipients = await buildRecipients(b.mode, b.filters as BroadcastFilters, b.viaBotId);
  if (!recipients.length) throw badRequest('Нет получателей по выбранным фильтрам');
  for (let i = 0; i < recipients.length; i += 1000) {
    await prisma.broadcastRecipient.createMany({ data: recipients.slice(i, i + 1000).map((r) => ({ broadcastId: id, ...r })), skipDuplicates: true });
  }
  const total = await prisma.broadcastRecipient.count({ where: { broadcastId: id } });
  await prisma.broadcast.update({ where: { id }, data: { status: 'RUNNING', total, startedAt: new Date() } });
  await enqueuePending(id);
  await audit('broadcast.start', { actorId, entity: 'Broadcast', entityId: id, meta: { total, mode: b.mode } });
  return prisma.broadcast.findUniqueOrThrow({ where: { id } });
}

/** Enqueues all pending recipients; jobId = recipient id, so re-running after a restart never duplicates. */
export async function enqueuePending(broadcastId: string) {
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.broadcastRecipient.findMany({
      where: { broadcastId, status: 'PENDING' },
      select: { id: true },
      take: 1000,
      orderBy: { id: 'asc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!batch.length) break;
    await queue(QUEUES.broadcast).addBulk(
      batch.map((r) => ({ name: 'send', data: { recipientId: r.id } satisfies BroadcastJob, opts: { jobId: `bc__${r.id}`, attempts: 4, backoff: { type: 'exponential', delay: 5000 } } })),
    );
    cursor = batch[batch.length - 1]!.id;
  }
}

export async function stopBroadcast(id: string, actorId: string) {
  await prisma.broadcast.update({ where: { id }, data: { status: 'STOPPED', finishedAt: new Date() } });
  await prisma.broadcastRecipient.updateMany({ where: { broadcastId: id, status: 'PENDING' }, data: { status: 'SKIPPED' } });
  await audit('broadcast.stop', { actorId, entity: 'Broadcast', entityId: id });
}

export class RateLimited extends Error {
  constructor(public retryAfterMs: number) {
    super('rate limited');
  }
}

/** Sends one recipient. Throws RateLimited on 429 so the worker pauses the whole queue. */
export async function sendBroadcastRecipient(recipientId: string, attemptsMade: number, maxAttempts: number) {
  const r = await prisma.broadcastRecipient.findUnique({ where: { id: recipientId }, include: { broadcast: true, bot: true } });
  if (!r || r.status !== 'PENDING') return;
  if (r.broadcast.status !== 'RUNNING') {
    await prisma.broadcastRecipient.update({ where: { id: r.id }, data: { status: 'SKIPPED' } });
    return finishIfDone(r.broadcastId);
  }
  const media = r.broadcast.mediaId ? await prisma.mediaFile.findUnique({ where: { id: r.broadcast.mediaId } }) : null;
  const buttons = (r.broadcast.buttons as unknown as TemplateButton[]).map((b) => [b]);
  try {
    await sendRich(apiForBot(r.bot), r.botId, r.chatTgId, { html: sanitizeTelegramHtml(r.broadcast.text), media, buttons });
    await prisma.$transaction([
      prisma.broadcastRecipient.update({ where: { id: r.id }, data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } } }),
      prisma.broadcast.update({ where: { id: r.broadcastId }, data: { sent: { increment: 1 } } }),
    ]);
  } catch (e) {
    if (e instanceof TelegramError && e.isRateLimit) throw new RateLimited((e.retryAfter ?? 5) * 1000);
    const err = e instanceof TelegramError ? e.description : (e as Error).message;
    let status: 'BLOCKED' | 'PERMISSION_LOST' | 'FAILED' | null = null;
    if (e instanceof TelegramError && (e.isBlocked || e.isChatGone)) status = r.broadcast.mode === 'MAIN_BOT_USERS' ? 'BLOCKED' : 'PERMISSION_LOST';
    else if (e instanceof TelegramError && e.isMissingPermission) status = 'PERMISSION_LOST';
    else if (attemptsMade + 1 >= maxAttempts) status = 'FAILED';
    if (!status) throw e; // retry with backoff
    const counter = status === 'BLOCKED' ? 'blocked' : status === 'PERMISSION_LOST' ? 'permissionLost' : 'failed';
    await prisma.$transaction([
      prisma.broadcastRecipient.update({ where: { id: r.id }, data: { status, error: err.slice(0, 500), attempts: { increment: 1 } } }),
      prisma.broadcast.update({ where: { id: r.broadcastId }, data: { [counter]: { increment: 1 } } }),
    ]);
    // keep monitoring data in sync
    if (r.broadcast.mode === 'MAIN_BOT_USERS' && status === 'BLOCKED')
      await prisma.botUser.updateMany({ where: { botId: r.botId, tgUserId: r.chatTgId }, data: { isBlocked: true } });
    if (status === 'PERMISSION_LOST')
      await prisma.telegramChat.updateMany({
        where: { botId: r.botId, chatId: r.chatTgId },
        data: { status: e instanceof TelegramError && e.isChatGone ? 'BOT_REMOVED' : 'PERMISSION_MISSING' },
      });
  }
  await finishIfDone(r.broadcastId);
}

async function finishIfDone(broadcastId: string) {
  const pending = await prisma.broadcastRecipient.count({ where: { broadcastId, status: 'PENDING' } });
  if (pending === 0) {
    await prisma.broadcast.updateMany({ where: { id: broadcastId, status: 'RUNNING' }, data: { status: 'COMPLETED', finishedAt: new Date() } });
  }
}
