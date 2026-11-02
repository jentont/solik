import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import { apiForBot, getPlatformBotId } from '../../telegram/registry.js';
import { statusFromMember } from '../../modules/chats/tracking.js';
import { checkBotStatus, connectBot, deleteBot, publicBot, setBotEnabled, updateBotProfile } from '../../modules/bots/service.js';
import { requireAuth, uid } from '../auth.js';
import { ownBot, ownChannel, ownChat } from '../ownership.js';
import { invalidateWebhookBot } from '../webhook.js';
import { parse } from '../validate.js';

const profileSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(512).optional(),
  shortDescription: z.string().max(120).optional(),
  welcomeText: z.string().max(4000).optional(),
  welcomeMediaId: z.string().nullable().optional(),
  avatarMediaId: z.string().nullable().optional(),
  commands: z.array(z.object({ command: z.string().regex(/^[a-z0-9_]{1,32}$/), description: z.string().min(1).max(256) })).max(50).optional(),
  menuButtons: z.array(z.object({ text: z.string().min(1).max(64), url: z.string().url() })).max(10).optional(),
});

const settingsSchema = z.object({
  defaultPrizeId: z.string().nullable().optional(),
  smsPrizeQueue: z.array(z.object({ position: z.number().int().min(1).max(100000), title: z.string().min(1).max(100), giftId: z.string().optional() })).max(50).optional(),
});

export async function botRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/bots', async (req) => {
    const userId = uid(req);
    const bots = await prisma.telegramBot.findMany({
      where: { OR: [{ ownerId: userId }, { isPlatform: true }] },
      include: {
        subscription: { select: { id: true, status: true, periodEnd: true, autoRenew: true, priceStars: true } },
        _count: { select: { contests: { where: { ownerId: userId } } } },
      },
      orderBy: [{ isPlatform: 'desc' }, { createdAt: 'asc' }],
    });
    const result = [];
    for (const b of bots) {
      const chatWhere = b.isPlatform ? { botId: b.id, ownerId: userId } : { botId: b.id };
      const [chats, channels, participants] = await Promise.all([
        prisma.telegramChat.findMany({ where: chatWhere, select: { id: true, title: true, status: true, kind: true, chatId: true } }),
        prisma.telegramChannel.findMany({ where: chatWhere, select: { id: true, title: true, status: true, username: true, chatId: true } }),
        prisma.contestParticipant.count({ where: { contest: { botId: b.id, ownerId: userId } } }),
      ]);
      result.push({ ...publicBot(b), chats, channels, contestsCount: b._count.contests, participantsCount: participants });
    }
    return result;
  });

  app.post('/api/bots', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(20).max(100) }), req.body);
    return connectBot(uid(req), token);
  });

  app.get<{ Params: { id: string } }>('/api/bots/:id', async (req) => {
    const userId = uid(req);
    const bot = req.params.id === getPlatformBotId()
      ? await prisma.telegramBot.findUniqueOrThrow({ where: { id: req.params.id } })
      : await ownBot(userId, req.params.id);
    const scope = bot.isPlatform ? { botId: bot.id, ownerId: userId } : { botId: bot.id };
    const [chats, channels, subscription, business] = await Promise.all([
      prisma.telegramChat.findMany({ where: scope, orderBy: { connectedAt: 'desc' } }),
      prisma.telegramChannel.findMany({ where: scope, include: { discussionChat: { select: { id: true, title: true } } }, orderBy: { connectedAt: 'desc' } }),
      bot.isPlatform ? null : prisma.botSubscription.findUnique({ where: { botId: bot.id }, include: { plan: true, payments: { orderBy: { paidAt: 'desc' }, take: 20 } } }),
      prisma.telegramBusinessConnection.findMany({ where: { botId: bot.id, ownerId: userId }, include: { ownedGifts: true } }),
    ]);
    return { bot: publicBot(bot), chats, channels, subscription, business };
  });

  app.patch<{ Params: { id: string } }>('/api/bots/:id/profile', async (req) => {
    await ownBot(uid(req), req.params.id);
    return updateBotProfile(req.params.id, uid(req), parse(profileSchema, req.body));
  });

  app.patch<{ Params: { id: string } }>('/api/bots/:id/settings', async (req) => {
    const bot = await ownBot(uid(req), req.params.id);
    const body = parse(settingsSchema, req.body);
    const settings = { ...(bot.settings as object), ...(body.smsPrizeQueue ? { smsPrizeQueue: body.smsPrizeQueue } : {}) };
    const updated = await prisma.telegramBot.update({
      where: { id: bot.id },
      data: { settings, ...(body.defaultPrizeId !== undefined ? { defaultPrizeId: body.defaultPrizeId } : {}) },
    });
    invalidateWebhookBot(bot.id);
    return publicBot(updated);
  });

  app.post<{ Params: { id: string } }>('/api/bots/:id/check', async (req) => {
    await ownBot(uid(req), req.params.id);
    return checkBotStatus(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/bots/:id/enable', async (req) => {
    await ownBot(uid(req), req.params.id);
    invalidateWebhookBot(req.params.id);
    return setBotEnabled(req.params.id, uid(req), true);
  });
  app.post<{ Params: { id: string } }>('/api/bots/:id/disable', async (req) => {
    await ownBot(uid(req), req.params.id);
    invalidateWebhookBot(req.params.id);
    return setBotEnabled(req.params.id, uid(req), false);
  });

  app.delete<{ Params: { id: string } }>('/api/bots/:id', async (req) => {
    await ownBot(uid(req), req.params.id);
    invalidateWebhookBot(req.params.id);
    await deleteBot(req.params.id, uid(req));
    return { ok: true };
  });

  // ── chats & channels of the current user ──
  app.get('/api/chats', async (req) => {
    const userId = uid(req);
    const scope = { OR: [{ ownerId: userId }, { bot: { ownerId: userId } }] };
    const [chats, channels] = await Promise.all([
      prisma.telegramChat.findMany({ where: scope, include: { bot: { select: { id: true, username: true, isPlatform: true } } }, orderBy: { connectedAt: 'desc' } }),
      prisma.telegramChannel.findMany({
        where: scope,
        include: { bot: { select: { id: true, username: true, isPlatform: true } }, discussionChat: { select: { id: true, title: true, chatId: true } } },
        orderBy: { connectedAt: 'desc' },
      }),
    ]);
    return { chats, channels };
  });

  app.get<{ Params: { id: string } }>('/api/channels/:id/posts', async (req) => {
    const ch = await ownChannel(uid(req), req.params.id);
    return prisma.channelPost.findMany({ where: { channelId: ch.id }, orderBy: { messageId: 'desc' }, take: 50 });
  });

  /** Re-checks the bot's rights in a chat and updates its status. */
  app.post<{ Params: { id: string } }>('/api/chats/:id/refresh', async (req) => {
    const chat = await ownChat(uid(req), req.params.id).catch(() => null);
    const channel = chat ? null : await ownChannel(uid(req), req.params.id);
    const target = chat ?? channel!;
    const bot = await prisma.telegramBot.findUniqueOrThrow({ where: { id: target.botId } });
    const api = apiForBot(bot);
    const member = await api.getChatMember(target.chatId, bot.telegramId).catch(() => null);
    const status = member ? statusFromMember(member, !!channel) : 'BOT_REMOVED';
    const memberCount = await api.getChatMemberCount(target.chatId).catch(() => null);
    if (chat) return prisma.telegramChat.update({ where: { id: chat.id }, data: { status, isAdmin: member?.status === 'administrator', memberCount: memberCount ?? undefined } });
    return prisma.telegramChannel.update({ where: { id: channel!.id }, data: { status, isAdmin: member?.status === 'administrator', canPost: !!member?.can_post_messages, memberCount: memberCount ?? undefined } });
  });

  app.delete<{ Params: { id: string } }>('/api/chats/:id', async (req) => {
    const chat = await ownChat(uid(req), req.params.id).catch(() => null);
    if (chat) await prisma.telegramChat.update({ where: { id: chat.id }, data: { status: 'DISCONNECTED' } });
    else {
      const ch = await ownChannel(uid(req), req.params.id);
      await prisma.telegramChannel.update({ where: { id: ch.id }, data: { status: 'DISCONNECTED' } });
    }
    await audit('chat.disconnect', { actorId: uid(req), entityId: req.params.id });
    return { ok: true };
  });
}
