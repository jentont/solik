import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { sendRich, type TemplateButton } from '../../telegram/messenger.js';
import { apiForBot, getPlatformBotId, mainApi } from '../../telegram/registry.js';
import { sanitizeTelegramHtml } from '../../templates/render.js';
import { publicBot } from '../../modules/bots/service.js';
import { previewBroadcast, startBroadcast, stopBroadcast, type BroadcastFilters } from '../../modules/broadcasts/service.js';
import { giftImportSchema, importGifts, verifyGiftsWithTelegram } from '../../modules/gifts/catalog.js';
import { ensureDefaultPlan } from '../../modules/subscriptions/plans.js';
import { requireAdmin, requireOwner, uid } from '../auth.js';
import { invalidateWebhookBot } from '../webhook.js';
import { pageQuery, parse } from '../validate.js';

const DAY = 86_400_000;

export async function adminRoutes(app: FastifyInstance) {
  // Emoji preview (public, cached) — thumbnails from getCustomEmojiStickers
  app.get<{ Params: { id: string } }>('/api/emoji/:id/preview', async (req, reply) => {
    const e = await prisma.premiumEmoji.findUnique({ where: { customEmojiId: req.params.id } });
    if (!e?.stickerFileId) throw notFound();
    const file = await mainApi.getFile(e.stickerFileId);
    if (!file.file_path) throw notFound();
    const res = await fetch(mainApi.fileUrl(file.file_path));
    reply.header('cache-control', 'public, max-age=604800').type(file.file_path.endsWith('.webm') ? 'video/webm' : file.file_path.endsWith('.tgs') ? 'application/x-tgsticker' : 'image/webp');
    return reply.send(Buffer.from(await res.arrayBuffer()));
  });

  app.register(async (r) => {
    r.addHook('preHandler', requireAdmin);
    // every mutating admin request is audited
    r.addHook('onResponse', async (req, reply) => {
      if (req.method !== 'GET' && reply.statusCode < 400) {
        await audit(`admin.${req.method.toLowerCase()} ${req.routeOptions.url}`, { actorId: req.user?.id, meta: { params: req.params }, ip: req.ip });
      }
    });

    r.get('/api/admin/stats', async () => {
      const now = new Date();
      const [users, wlBots, activeSubs, chats, channels, contests, activeContests, revenue, revenue30] = await Promise.all([
        prisma.user.count(),
        prisma.telegramBot.count({ where: { isPlatform: false } }),
        prisma.botSubscription.count({ where: { status: { in: ['ACTIVE', 'CANCELLED', 'GRACE'] } } }),
        prisma.telegramChat.count({ where: { status: 'ACTIVE' } }),
        prisma.telegramChannel.count({ where: { status: 'ACTIVE' } }),
        prisma.contest.count(),
        prisma.contest.count({ where: { status: 'ACTIVE' } }),
        prisma.subscriptionPayment.aggregate({ where: { refunded: false }, _sum: { amount: true } }),
        prisma.subscriptionPayment.aggregate({ where: { refunded: false, paidAt: { gte: new Date(now.getTime() - 30 * DAY) } }, _sum: { amount: true } }),
      ]);
      return { users, wlBots, activeSubs, chats, channels, contests, activeContests, revenueStars: revenue._sum.amount ?? 0, revenue30Stars: revenue30._sum.amount ?? 0 };
    });

    // ── All bots ──
    r.get('/api/admin/bots', async (req) => {
      const q = parse(pageQuery.extend({ filter: z.enum(['all', 'active', 'inactive', 'expired', 'new', 'with_contests', 'suspended']).default('all') }), req.query);
      const where: Prisma.TelegramBotWhereInput = {
        ...(q.filter === 'active' ? { status: 'ACTIVE' } : {}),
        ...(q.filter === 'inactive' ? { OR: [{ status: { in: ['DISABLED', 'INVALID_TOKEN'] } }, { lastActivityAt: { lt: new Date(Date.now() - 7 * DAY) } }, { lastActivityAt: null }] } : {}),
        ...(q.filter === 'expired' ? { status: 'SUBSCRIPTION_EXPIRED' } : {}),
        ...(q.filter === 'suspended' ? { status: 'SUSPENDED' } : {}),
        ...(q.filter === 'new' ? { createdAt: { gte: new Date(Date.now() - 7 * DAY) } } : {}),
        ...(q.filter === 'with_contests' ? { contests: { some: { status: 'ACTIVE' } } } : {}),
        ...(q.q
          ? {
              AND: [
                {
                  OR: [
                    { username: { contains: q.q.replace('@', ''), mode: 'insensitive' } },
                    { name: { contains: q.q, mode: 'insensitive' } },
                    ...(/^\d+$/.test(q.q) ? [{ telegramId: BigInt(q.q) }, { owner: { telegramId: BigInt(q.q) } }] : []),
                    { owner: { username: { contains: q.q.replace('@', ''), mode: 'insensitive' } } },
                  ],
                },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.telegramBot.findMany({
          where,
          include: {
            owner: { select: { id: true, telegramId: true, username: true } },
            subscription: { select: { status: true, periodEnd: true } },
            _count: { select: { chats: true, channels: true, contests: { where: { status: 'ACTIVE' } } } },
          },
          orderBy: [{ isPlatform: 'desc' }, { createdAt: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        prisma.telegramBot.count({ where }),
      ]);
      const withParticipants = await Promise.all(
        items.map(async (b) => ({ ...publicBot(b), participantsCount: await prisma.contestParticipant.count({ where: { contest: { botId: b.id } } }) })),
      );
      return { items: withParticipants, total };
    });

    r.get<{ Params: { id: string } }>('/api/admin/bots/:id', async (req) => {
      const bot = await prisma.telegramBot.findUnique({
        where: { id: req.params.id },
        include: { owner: true, subscription: { include: { payments: true, plan: true } }, chats: true, channels: true },
      });
      if (!bot) throw notFound();
      const [contests, logs, webhookErrors] = await Promise.all([
        prisma.contest.findMany({ where: { botId: bot.id }, orderBy: { createdAt: 'desc' }, take: 50, include: { _count: { select: { participants: true } } } }),
        prisma.activityLog.findMany({ where: { OR: [{ entityId: bot.id }, { meta: { path: ['botId'], equals: bot.id } }] }, orderBy: { createdAt: 'desc' }, take: 100 }),
        prisma.webhookEvent.findMany({ where: { botId: bot.id, error: { not: null } }, orderBy: { receivedAt: 'desc' }, take: 50 }),
      ]);
      const stats = {
        updates24h: await prisma.webhookEvent.count({ where: { botId: bot.id, receivedAt: { gte: new Date(Date.now() - DAY) } } }),
        participants: await prisma.contestParticipant.count({ where: { contest: { botId: bot.id } } }),
        winners: await prisma.contestWinner.count({ where: { contest: { botId: bot.id } } }),
        users: await prisma.botUser.count({ where: { botId: bot.id } }),
      };
      return { bot: publicBot(bot), contests, logs, webhookErrors, stats };
    });

    r.post<{ Params: { id: string } }>('/api/admin/bots/:id/suspend', async (req) => {
      const { reason } = parse(z.object({ reason: z.string().max(500).default('') }), req.body ?? {});
      const bot = await prisma.telegramBot.update({ where: { id: req.params.id }, data: { status: 'SUSPENDED', suspendedReason: reason } });
      invalidateWebhookBot(bot.id);
      await prisma.telegramChat.updateMany({ where: { botId: bot.id, status: 'ACTIVE' }, data: { status: 'SUSPENDED' } });
      return publicBot(bot);
    });
    r.post<{ Params: { id: string } }>('/api/admin/bots/:id/resume', async (req) => {
      const sub = await prisma.botSubscription.findUnique({ where: { botId: req.params.id } });
      const expired = sub && sub.status === 'EXPIRED';
      const bot = await prisma.telegramBot.update({ where: { id: req.params.id }, data: { status: expired ? 'SUBSCRIPTION_EXPIRED' : 'ACTIVE', suspendedReason: null } });
      invalidateWebhookBot(bot.id);
      await prisma.telegramChat.updateMany({ where: { botId: bot.id, status: 'SUSPENDED' }, data: { status: 'ACTIVE' } });
      return publicBot(bot);
    });

    // ── Connected chats ──
    r.get('/api/admin/chats', async (req) => {
      const q = parse(
        pageQuery.extend({
          kind: z.enum(['all', 'GROUP', 'SUPERGROUP', 'DISCUSSION', 'CHANNEL']).default('all'),
          status: z.string().optional(),
          botId: z.string().optional(),
        }),
        req.query,
      );
      const search = q.q
        ? { OR: [{ title: { contains: q.q, mode: 'insensitive' as const } }, { username: { contains: q.q.replace('@', ''), mode: 'insensitive' as const } }, ...(/^-?\d+$/.test(q.q) ? [{ chatId: BigInt(q.q) }] : [])] }
        : {};
      const common = { ...(q.status ? { status: { in: q.status.split(',') as any } } : {}), ...(q.botId ? { botId: q.botId } : {}), ...search };
      const botSel = { select: { id: true, username: true, isPlatform: true, ownerId: true, owner: { select: { username: true, telegramId: true } } } };
      if (q.kind === 'CHANNEL') {
        const [items, total] = await Promise.all([
          prisma.telegramChannel.findMany({ where: common, include: { bot: botSel, _count: { select: { contests: { where: { status: 'ACTIVE' } } } } }, orderBy: { lastActivityAt: { sort: 'desc', nulls: 'last' } }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
          prisma.telegramChannel.count({ where: common }),
        ]);
        return { items: items.map((c) => ({ ...c, type: 'CHANNEL' })), total };
      }
      const where: Prisma.TelegramChatWhereInput = {
        ...common,
        ...(q.kind === 'GROUP' ? { kind: 'GROUP', linkedChannelChatId: null } : {}),
        ...(q.kind === 'SUPERGROUP' ? { kind: 'SUPERGROUP', linkedChannelChatId: null } : {}),
        ...(q.kind === 'DISCUSSION' ? { linkedChannelChatId: { not: null } } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.telegramChat.findMany({ where, include: { bot: botSel, _count: { select: { contests: { where: { status: 'ACTIVE' } } } } }, orderBy: { lastActivityAt: { sort: 'desc', nulls: 'last' } }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        prisma.telegramChat.count({ where }),
      ]);
      return { items: items.map((c) => ({ ...c, type: c.linkedChannelChatId ? 'DISCUSSION' : c.kind })), total };
    });

    r.get<{ Params: { id: string } }>('/api/admin/chats/:id', async (req) => {
      const chat =
        (await prisma.telegramChat.findUnique({ where: { id: req.params.id }, include: { bot: { include: { owner: true } }, owner: true, channels: true } })) ??
        (await prisma.telegramChannel.findUnique({ where: { id: req.params.id }, include: { bot: { include: { owner: true } }, owner: true, discussionChat: true } }));
      if (!chat) throw notFound();
      const contestWhere = { OR: [{ chatId: chat.id }, { channelId: chat.id }] };
      const [contests, logs] = await Promise.all([
        prisma.contest.findMany({ where: contestWhere, orderBy: { createdAt: 'desc' }, take: 100, include: { _count: { select: { participants: true, winners: true } } } }),
        prisma.activityLog.findMany({ where: { meta: { path: ['chatId'], equals: Number(chat.chatId) } }, orderBy: { createdAt: 'desc' }, take: 100 }),
      ]);
      return { chat: { ...chat, bot: publicBot(chat.bot) }, contests, logs };
    });

    // ── Users & roles ──
    r.get('/api/admin/users', async (req) => {
      const q = parse(pageQuery, req.query);
      const where: Prisma.UserWhereInput = q.q
        ? { OR: [{ username: { contains: q.q.replace('@', ''), mode: 'insensitive' } }, { firstName: { contains: q.q, mode: 'insensitive' } }, ...(/^\d+$/.test(q.q) ? [{ telegramId: BigInt(q.q) }] : [])] }
        : {};
      const [items, total] = await Promise.all([
        prisma.user.findMany({ where, include: { _count: { select: { bots: true, contests: true, botSubscriptions: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        prisma.user.count({ where }),
      ]);
      return { items, total };
    });
    r.post<{ Params: { id: string } }>('/api/admin/users/:id/role', { preHandler: requireOwner }, async (req) => {
      const { role, permissions } = parse(z.object({ role: z.enum(['USER', 'ADMIN', 'OWNER']), permissions: z.array(z.string()).default([]) }), req.body);
      if (req.params.id === uid(req) && role !== 'OWNER') throw badRequest('Нельзя понизить собственную роль');
      const user = await prisma.user.update({ where: { id: req.params.id }, data: { role } });
      if (role === 'USER') await prisma.adminRole.deleteMany({ where: { userId: user.id } });
      else await prisma.adminRole.upsert({ where: { userId: user.id }, create: { userId: user.id, role, permissions }, update: { role, permissions } });
      return user;
    });
    r.post<{ Params: { id: string } }>('/api/admin/users/:id/block', async (req) => {
      const { blocked } = parse(z.object({ blocked: z.boolean() }), req.body);
      if (req.params.id === uid(req)) throw badRequest('Нельзя заблокировать себя');
      return prisma.user.update({ where: { id: req.params.id }, data: { isBlocked: blocked } });
    });

    r.get('/api/admin/contests', async (req) => {
      const q = parse(pageQuery.extend({ status: z.string().optional() }), req.query);
      const where: Prisma.ContestWhereInput = { ...(q.status ? { status: { in: q.status.split(',') as any } } : {}), ...(q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {}) };
      const [items, total] = await Promise.all([
        prisma.contest.findMany({
          where,
          include: { owner: { select: { username: true, telegramId: true } }, bot: { select: { username: true } }, _count: { select: { participants: true, winners: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        prisma.contest.count({ where }),
      ]);
      return { items, total };
    });

    // ── Subscriptions & plans ──
    r.get('/api/admin/subscriptions', async (req) => {
      const q = parse(pageQuery.extend({ status: z.string().optional() }), req.query);
      const where: Prisma.BotSubscriptionWhereInput = { status: q.status ? { in: q.status.split(',') as any } : { not: 'PENDING' } };
      const [items, total, payments, byStatus] = await Promise.all([
        prisma.botSubscription.findMany({
          where,
          include: { owner: { select: { username: true, telegramId: true } }, bot: { select: { username: true } }, plan: true, _count: { select: { payments: true } } },
          orderBy: { updatedAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        prisma.botSubscription.count({ where }),
        prisma.subscriptionPayment.findMany({ include: { subscription: { include: { owner: { select: { username: true } }, bot: { select: { username: true } } } } }, orderBy: { paidAt: 'desc' }, take: 50 }),
        prisma.botSubscription.groupBy({ by: ['status'], _count: true }),
      ]);
      return { items, total, payments, byStatus };
    });

    r.get('/api/admin/plans', async () => {
      await ensureDefaultPlan();
      return prisma.whiteLabelPlan.findMany({ orderBy: { priceStars: 'asc' }, include: { _count: { select: { subscriptions: true } } } });
    });
    const planSchema = z.object({
      code: z.string().regex(/^[a-z0-9-]{2,40}$/),
      name: z.string().min(1).max(60),
      priceStars: z.number().int().min(1).max(100_000),
      periodDays: z.number().int().min(1).max(365),
      graceDays: z.number().int().min(0).max(30),
      limits: z.record(z.unknown()).default({}),
      isActive: z.boolean().default(true),
      isDefault: z.boolean().default(false),
    });
    r.post('/api/admin/plans', { preHandler: requireOwner }, async (req) => {
      const body = parse(planSchema, req.body);
      if (body.isDefault) await prisma.whiteLabelPlan.updateMany({ data: { isDefault: false } });
      return prisma.whiteLabelPlan.create({ data: { ...body, limits: body.limits as Prisma.InputJsonValue } });
    });
    // Price changes apply to new purchases and renewals; existing paid periods are untouched.
    r.patch<{ Params: { id: string } }>('/api/admin/plans/:id', { preHandler: requireOwner }, async (req) => {
      const body = parse(planSchema.partial(), req.body);
      if (body.isDefault) await prisma.whiteLabelPlan.updateMany({ data: { isDefault: false } });
      return prisma.whiteLabelPlan.update({ where: { id: req.params.id }, data: { ...body, limits: body.limits as Prisma.InputJsonValue | undefined } });
    });

    // ── Gifts & emoji ──
    r.post('/api/admin/gifts/import', async (req) => importGifts(parse(giftImportSchema, req.body), uid(req)));
    r.post('/api/admin/gifts/verify', async () => verifyGiftsWithTelegram());
    r.patch<{ Params: { id: string } }>('/api/admin/gifts/:id', async (req) => {
      const body = parse(
        z.object({
          name: z.string().max(100).optional(),
          type: z.enum(['REGULAR', 'LIMITED', 'COLLECTIBLE', 'REMOVED', 'NFT']).optional(),
          imageUrl: z.string().max(500).nullable().optional(),
          collection: z.string().max(100).nullable().optional(),
          rarity: z.string().max(50).nullable().optional(),
        }),
        req.body,
      );
      return prisma.telegramGift.update({ where: { id: req.params.id }, data: body });
    });
    r.post('/api/admin/emoji/import', async (req) => {
      const items = parse(
        z.array(z.object({ customEmojiId: z.string().regex(/^\d{5,25}$/), name: z.string().min(1).max(60), category: z.string().max(40).default('general'), fallback: z.string().max(8).optional() })).max(500),
        req.body,
      );
      const stickers = new Map<string, { emoji?: string; file_id: string; thumbnail?: { file_id: string } }>();
      for (let i = 0; i < items.length; i += 200) {
        const res = await mainApi.getCustomEmojiStickers(items.slice(i, i + 200).map((e) => e.customEmojiId)).catch(() => []);
        for (const s of res) stickers.set(s.custom_emoji_id, s);
      }
      let imported = 0;
      for (const e of items) {
        const s = stickers.get(e.customEmojiId);
        await prisma.premiumEmoji.upsert({
          where: { customEmojiId: e.customEmojiId },
          create: { ...e, fallback: e.fallback ?? s?.emoji ?? '⭐', stickerFileId: s?.thumbnail?.file_id ?? s?.file_id, isActive: !!s },
          update: { name: e.name, category: e.category, fallback: e.fallback ?? s?.emoji ?? undefined, stickerFileId: s?.thumbnail?.file_id ?? s?.file_id, isActive: !!s },
        });
        imported++;
      }
      return { imported, verified: stickers.size, notFound: items.filter((e) => !stickers.has(e.customEmojiId)).map((e) => e.customEmojiId) };
    });
    r.patch<{ Params: { id: string } }>('/api/admin/emoji/:id', async (req) => {
      const body = parse(z.object({ name: z.string().max(60).optional(), category: z.string().max(40).optional(), isActive: z.boolean().optional() }), req.body);
      return prisma.premiumEmoji.update({ where: { id: req.params.id }, data: body });
    });

    // ── Logs & integrations ──
    r.get('/api/admin/logs', async (req) => {
      const q = parse(pageQuery.extend({ level: z.string().optional(), action: z.string().optional() }), req.query);
      const where: Prisma.ActivityLogWhereInput = {
        ...(q.level ? { level: { in: q.level.split(',') } } : {}),
        ...(q.action ? { action: { contains: q.action } } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.activityLog.findMany({ where, include: { actor: { select: { username: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        prisma.activityLog.count({ where }),
      ]);
      return { items, total };
    });
    r.get('/api/admin/errors', async () => ({
      webhook: await prisma.webhookEvent.findMany({ where: { error: { not: null } }, include: { bot: { select: { username: true } } }, orderBy: { receivedAt: 'desc' }, take: 100 }),
      deliveries: await prisma.giftDelivery.findMany({ where: { status: 'FAILED' }, orderBy: { updatedAt: 'desc' }, take: 50 }),
      aiJobs: await prisma.aIJob.findMany({ where: { status: 'FAILED' }, orderBy: { updatedAt: 'desc' }, take: 50 }),
    }));
    r.get('/api/admin/integrations', async () => {
      const [db, rd, webhook, balance] = await Promise.all([
        prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
        redis().ping().then(() => true).catch(() => false),
        mainApi.getWebhookInfo().catch((e) => ({ error: String(e) })),
        mainApi.getMyStarBalance().catch(() => null),
      ]);
      return { database: db, redis: rd, mainBotWebhook: webhook, mainBotStars: balance, ai: { provider: env.AI_PROVIDER, configured: !!env.GEMINI_API_KEY, textModel: env.GEMINI_TEXT_MODEL, imageModel: env.GEMINI_IMAGE_MODEL } };
    });
    r.get('/api/admin/settings', async () => prisma.platformSetting.findMany());
    r.put<{ Params: { key: string } }>('/api/admin/settings/:key', { preHandler: requireOwner }, async (req) => {
      if (!/^[a-z_]{2,40}$/.test(req.params.key)) throw badRequest('Неверный ключ');
      const value = parse(z.record(z.unknown()), req.body) as Prisma.InputJsonValue;
      return prisma.platformSetting.upsert({ where: { key: req.params.key }, create: { key: req.params.key, value }, update: { value } });
    });

    // ── Broadcasts ──
    const bcSchema = z.object({
      mode: z.enum(['ALL_CHATS', 'WHITE_LABEL_CHATS', 'MAIN_BOT_CHATS', 'MAIN_BOT_USERS']),
      filters: z
        .object({
          botIds: z.array(z.string()).optional(),
          ownerIds: z.array(z.string()).optional(),
          onlyActiveBots: z.boolean().optional(),
          onlyValidSubscription: z.boolean().optional(),
          chatKinds: z.array(z.enum(['GROUP', 'SUPERGROUP', 'DISCUSSION'])).optional(),
          segment: z.enum(['all', 'active', 'new', 'with_subscription', 'without_subscription', 'wl_owners', 'contest_creators', 'inactive']).optional(),
          inactiveDays: z.number().int().min(1).max(365).optional(),
        })
        .default({}),
      viaBotId: z.string().nullable().optional(),
      text: z.string().min(1).max(4096),
      mediaId: z.string().nullable().optional(),
      buttons: z.array(z.object({ text: z.string().min(1).max(64), url: z.string().url() })).max(10).default([]),
    });
    r.get('/api/admin/broadcasts', async () =>
      prisma.broadcast.findMany({ include: { createdBy: { select: { username: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    );
    r.post('/api/admin/broadcasts', async (req) => {
      const body = parse(bcSchema, req.body);
      return prisma.broadcast.create({ data: { ...body, createdById: uid(req), filters: body.filters as Prisma.InputJsonValue, buttons: body.buttons } });
    });
    r.put<{ Params: { id: string } }>('/api/admin/broadcasts/:id', async (req) => {
      const b = await prisma.broadcast.findUniqueOrThrow({ where: { id: req.params.id } });
      if (b.status !== 'DRAFT') throw badRequest('Изменять можно только черновик');
      const body = parse(bcSchema, req.body);
      return prisma.broadcast.update({ where: { id: b.id }, data: { ...body, filters: body.filters as Prisma.InputJsonValue, buttons: body.buttons } });
    });
    r.get<{ Params: { id: string } }>('/api/admin/broadcasts/:id', async (req) => {
      const b = await prisma.broadcast.findUniqueOrThrow({ where: { id: req.params.id } });
      const failures = await prisma.broadcastRecipient.findMany({ where: { broadcastId: b.id, status: { in: ['FAILED', 'BLOCKED', 'PERMISSION_LOST'] } }, take: 100, include: { bot: { select: { username: true } } } });
      return { ...b, failures };
    });
    r.post<{ Params: { id: string } }>('/api/admin/broadcasts/:id/preview', async (req) => {
      const b = await prisma.broadcast.findUniqueOrThrow({ where: { id: req.params.id } });
      return { ...(await previewBroadcast(b)), html: sanitizeTelegramHtml(b.text) };
    });
    r.post<{ Params: { id: string } }>('/api/admin/broadcasts/:id/test', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
      const { chatId, botId } = parse(z.object({ chatId: z.string().regex(/^-?\d+$/).optional(), botId: z.string().optional() }), req.body ?? {});
      const b = await prisma.broadcast.findUniqueOrThrow({ where: { id: req.params.id } });
      const bot = await prisma.telegramBot.findUniqueOrThrow({ where: { id: botId ?? b.viaBotId ?? getPlatformBotId() } });
      const media = b.mediaId ? await prisma.mediaFile.findUnique({ where: { id: b.mediaId } }) : null;
      await sendRich(apiForBot(bot), bot.id, BigInt(chatId ?? req.user!.telegramId), {
        html: sanitizeTelegramHtml(b.text),
        media,
        buttons: (b.buttons as unknown as TemplateButton[]).map((x) => [x]),
      }).catch((e) => {
        throw badRequest(`Тестовая отправка не удалась: ${(e as Error).message}`);
      });
      return { ok: true };
    });
    r.post<{ Params: { id: string } }>('/api/admin/broadcasts/:id/start', async (req) => {
      const { confirm } = parse(z.object({ confirm: z.literal(true) }), req.body);
      void confirm;
      return startBroadcast(req.params.id, uid(req));
    });
    r.post<{ Params: { id: string } }>('/api/admin/broadcasts/:id/stop', async (req) => {
      await stopBroadcast(req.params.id, uid(req));
      return { ok: true };
    });
    r.get('/api/admin/broadcast-targets', async () => ({
      bots: (await prisma.telegramBot.findMany({ select: { id: true, username: true, isPlatform: true, status: true, owner: { select: { id: true, username: true } } }, orderBy: { createdAt: 'asc' } })),
    }));
  });
}

export type { BroadcastFilters };
