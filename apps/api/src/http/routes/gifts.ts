import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { mainApi } from '../../telegram/registry.js';
import { refreshBusinessConnection, syncOwnedGifts, disconnectBusiness } from '../../modules/business/service.js';
import { BUSINESS_HELP, chooseMethod, enqueueDelivery, fundDelivery, markDeliveredManually, notifyOwnerManual } from '../../modules/gifts/delivery.js';
import { nftProviders } from '../../modules/nft/providers.js';
import { requireAuth, uid } from '../auth.js';
import { usableBot } from '../ownership.js';
import { pageQuery, parse } from '../validate.js';

export async function giftRoutes(app: FastifyInstance) {
  // Sticker preview proxy (public, cached): the bot token never reaches the browser
  app.get<{ Params: { id: string } }>('/api/gifts/:id/sticker', async (req, reply) => {
    const gift = await prisma.telegramGift.findUnique({ where: { id: req.params.id } });
    if (!gift?.stickerFileId) throw notFound();
    const file = await mainApi.getFile(gift.stickerFileId);
    if (!file.file_path) throw notFound();
    const res = await fetch(mainApi.fileUrl(file.file_path));
    reply.header('cache-control', 'public, max-age=86400');
    reply.type(file.file_path.endsWith('.tgs') ? 'application/x-tgsticker' : file.file_path.endsWith('.webm') ? 'video/webm' : 'image/webp');
    return reply.send(Buffer.from(await res.arrayBuffer()));
  });

  app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.get('/api/gifts/catalog', async (req) => {
      const q = parse(z.object({ type: z.string().optional(), q: z.string().max(100).optional(), onlyAvailable: z.coerce.boolean().optional() }), req.query);
      const where: Prisma.TelegramGiftWhereInput = {
        ...(q.type ? { type: { in: q.type.split(',') as any } } : {}),
        ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { telegramGiftId: { contains: q.q } }, { collection: { contains: q.q, mode: 'insensitive' } }] } : {}),
        ...(q.onlyAvailable ? { transferable: true } : {}),
      };
      const gifts = await prisma.telegramGift.findMany({ where, orderBy: [{ type: 'asc' }, { starCost: 'asc' }, { name: 'asc' }] });
      return gifts.map((g) => ({ ...g, delivery: chooseMethod({ kind: 'GIFT', gift: g, businessOwnedGiftId: null } as any) }));
    });

    r.get('/api/gifts/deliveries', async (req) => {
      const q = parse(pageQuery.extend({ status: z.string().optional() }), req.query);
      const where: Prisma.GiftDeliveryWhereInput = {
        OR: [{ contest: { ownerId: uid(req) } }, { bot: { ownerId: uid(req) } }],
        ...(q.status ? { status: { in: q.status.split(',') as any } } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.giftDelivery.findMany({
          where,
          include: { prize: true, gift: true, contest: { select: { id: true, title: true } }, bot: { select: { username: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        prisma.giftDelivery.count({ where }),
      ]);
      return { items, total };
    });

    async function ownDelivery(userId: string, id: string) {
      const d = await prisma.giftDelivery.findFirst({ where: { id, OR: [{ contest: { ownerId: userId } }, { bot: { ownerId: userId } }] } });
      if (!d) throw notFound('Выдача не найдена');
      return d;
    }

    r.post<{ Params: { id: string } }>('/api/gifts/deliveries/:id/retry', async (req) => {
      const d = await ownDelivery(uid(req), req.params.id);
      if (d.status === 'DELIVERED') throw conflict('Приз уже выдан');
      if (d.status === 'PROCESSING') throw conflict('Выдача выполняется');
      await prisma.giftDelivery.update({ where: { id: d.id }, data: { status: 'PENDING', error: null } });
      await enqueueDelivery(d.id);
      await audit('delivery.retry', { actorId: uid(req), entity: 'GiftDelivery', entityId: d.id });
      return { ok: true };
    });

    r.post<{ Params: { id: string } }>('/api/gifts/deliveries/:id/confirm', async (req) => {
      const d = await ownDelivery(uid(req), req.params.id);
      if (d.status === 'DELIVERED') return d;
      return markDeliveredManually(d.id, uid(req));
    });

    /** Manual delivery to any user by Telegram id (e.g. a prize outside of a contest). */
    r.post('/api/gifts/deliver', async (req) => {
      const body = parse(
        z.object({ botId: z.string(), recipientTgId: z.string().regex(/^\d{3,20}$/), giftId: z.string(), recipientName: z.string().max(100).optional() }),
        req.body,
      );
      const bot = await usableBot(uid(req), body.botId);
      const gift = await prisma.telegramGift.findUnique({ where: { id: body.giftId } });
      if (!gift) throw badRequest('Подарок не найден');
      const chosen = chooseMethod({ kind: 'GIFT', gift, businessOwnedGiftId: null } as any);
      const { method, note, businessConnectionId } = await fundDelivery(bot, uid(req), chosen);
      if (bot.isPlatform && chosen.method === 'BOT_SEND_GIFT' && method === 'MANUAL') throw badRequest(`Чтобы отправить подарок через @${bot.username}, оплатите его Stars своего аккаунта. ${BUSINESS_HELP}`);
      const d = await prisma.giftDelivery.create({
        data: {
          idempotencyKey: `manual:${uid(req)}:${Date.now()}`,
          botId: bot.id,
          giftId: gift.id,
          recipientTgId: BigInt(body.recipientTgId),
          recipientName: body.recipientName,
          method,
          businessConnectionId,
          note,
          status: method === 'MANUAL' ? 'MANUAL_REQUIRED' : 'PENDING',
        },
      });
      if (d.status === 'PENDING') await enqueueDelivery(d.id);
      else await notifyOwnerManual(d.id);
      await audit('delivery.manual_create', { actorId: uid(req), entity: 'GiftDelivery', entityId: d.id });
      return d;
    });

    r.get<{ Params: { botId: string } }>('/api/bots/:botId/stars-balance', async (req) => {
      const bot = await usableBot(uid(req), req.params.botId);
      if (bot.isPlatform) throw badRequest('Баланс доступен только для собственного бота');
      const { apiForBot } = await import('../../telegram/registry.js');
      return apiForBot(bot).getMyStarBalance();
    });

    // ── Telegram Business ──
    r.get('/api/business', async (req) =>
      prisma.telegramBusinessConnection.findMany({ where: { ownerId: uid(req) }, include: { ownedGifts: true, bot: { select: { username: true } } } }),
    );
    r.post<{ Params: { id: string } }>('/api/business/:id/refresh', async (req) => refreshBusinessConnection(req.params.id, uid(req)));
    r.post<{ Params: { id: string } }>('/api/business/:id/sync-gifts', async (req) => {
      const c = await prisma.telegramBusinessConnection.findFirst({ where: { id: req.params.id, ownerId: uid(req) } });
      if (!c) throw notFound();
      return syncOwnedGifts(c.id);
    });
    r.delete<{ Params: { id: string } }>('/api/business/:id', async (req) => {
      await disconnectBusiness(req.params.id, uid(req));
      return { ok: true };
    });

    // ── NFT assets ──
    r.get('/api/nft', async (req) => ({
      assets: await prisma.nFTAsset.findMany({ where: { ownerId: uid(req) }, orderBy: { createdAt: 'desc' } }),
      providers: Object.values(nftProviders).map((p) => ({ id: p.id, name: p.name, canTransfer: p.canTransfer })),
    }));
    r.post('/api/nft', async (req) => {
      const body = parse(
        z.object({
          provider: z.enum(Object.keys(nftProviders) as [string, ...string[]]),
          name: z.string().min(1).max(120),
          network: z.string().max(40).optional(),
          contractAddress: z.string().max(120).optional(),
          tokenId: z.string().max(120).optional(),
          imageUrl: z.string().url().optional(),
          externalUrl: z.string().url().optional(),
        }),
        req.body,
      );
      return prisma.nFTAsset.create({ data: { ...body, ownerId: uid(req) } });
    });
    r.delete<{ Params: { id: string } }>('/api/nft/:id', async (req) => {
      const a = await prisma.nFTAsset.findFirst({ where: { id: req.params.id, ownerId: uid(req) } });
      if (!a) throw notFound();
      if (a.status === 'RESERVED') throw conflict('NFT используется в конкурсе');
      await prisma.nFTAsset.delete({ where: { id: a.id } });
      return { ok: true };
    });
  });
}
