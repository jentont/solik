import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Prisma, TemplateKey } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { safeEqual } from '../../lib/crypto.js';
import { prisma } from '../../lib/prisma.js';
import { queue, QUEUES, type AIJobPayload } from '../../queues/index.js';
import { DEFAULT_TEMPLATES, TEMPLATE_LABELS } from '../../templates/defaults.js';
import { renderTemplate, TEMPLATE_VARIABLES } from '../../templates/render.js';
import { sendRich } from '../../telegram/messenger.js';
import { apiForBot } from '../../telegram/registry.js';
import { IMAGE_TEMPLATES } from '../../modules/ai/image.js';
import { mediaUrl, signMedia, storeMedia } from '../../modules/media/service.js';
import { requireAuth, uid } from '../auth.js';
import { ownBot, ownMedia, usableBot } from '../ownership.js';
import { parse } from '../validate.js';

const buttonsSchema = z.array(z.object({ text: z.string().min(1).max(64), url: z.string().url().optional(), callback: z.string().max(64).optional() })).max(10);

const SAMPLE_VARS = {
  username: '@winner',
  user_id: '123456789',
  first_name: 'Иван',
  owner_username: '@owner',
  chat_name: 'Мой чат',
  contest_name: 'Новогодний розыгрыш',
  prize_name: 'Teddy Bear',
  winner_username: '@winner',
  participants_count: 128,
  remaining_time: '3 мин',
  gift_name: 'Teddy Bear',
  stars_amount: 25,
  position: 37,
  channel_username: '@channel',
  remaining_slots: 63,
  target: 100,
  current_bid: 25,
  leader: '@leader',
  winners: '1. @winner — Teddy Bear',
  chance: '0,9',
};

export async function contentRoutes(app: FastifyInstance) {
  // signed public media URL (used by <img>/<video> in the panel and previews)
  app.get<{ Params: { id: string }; Querystring: { sig?: string } }>('/api/media/:id/file', async (req, reply) => {
    if (!req.query.sig || !safeEqual(req.query.sig, signMedia(req.params.id))) throw notFound();
    const m = await prisma.mediaFile.findUnique({ where: { id: req.params.id } });
    if (!m) throw notFound();
    reply.header('cache-control', 'private, max-age=86400').type(m.mime);
    return reply.send(createReadStream(path.resolve(env.UPLOAD_DIR, m.path)));
  });

  app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    // ── Media ──
    r.post('/api/media/upload', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
      const file = await req.file({ limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 } });
      if (!file) throw badRequest('Файл не передан');
      const buf = await file.toBuffer();
      const asAnimation = (file.fields as any)?.asAnimation?.value === 'true';
      const m = await storeMedia(uid(req), buf, { asAnimation });
      return { ...m, url: mediaUrl(m.id) };
    });
    r.get('/api/media', async (req) => {
      const q = parse(z.object({ kind: z.enum(['PHOTO', 'ANIMATION', 'VIDEO']).optional() }), req.query);
      const items = await prisma.mediaFile.findMany({ where: { ownerId: uid(req), ...(q.kind ? { kind: q.kind } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
      return items.map((m) => ({ ...m, url: mediaUrl(m.id) }));
    });
    r.delete<{ Params: { id: string } }>('/api/media/:id', async (req) => {
      const m = await ownMedia(uid(req), req.params.id);
      await prisma.mediaFile.delete({ where: { id: m.id } });
      return { ok: true };
    });

    // ── Templates ──
    r.get('/api/templates/meta', async () => ({
      keys: Object.entries(TEMPLATE_LABELS).map(([key, label]) => ({ key, label, default: DEFAULT_TEMPLATES[key as TemplateKey] })),
      variables: TEMPLATE_VARIABLES,
      sample: SAMPLE_VARS,
    }));
    r.get('/api/templates', async (req) => {
      const items = await prisma.messageTemplate.findMany({ where: { ownerId: uid(req) }, include: { media: true, bot: { select: { username: true } } }, orderBy: { updatedAt: 'desc' } });
      return items.map((t) => ({ ...t, media: t.media ? { ...t.media, url: mediaUrl(t.media.id) } : null }));
    });
    const tplSchema = z.object({
      key: z.enum(Object.keys(DEFAULT_TEMPLATES) as [TemplateKey, ...TemplateKey[]]),
      name: z.string().min(1).max(80),
      text: z.string().min(1).max(4096),
      botId: z.string().nullable().optional(),
      mediaId: z.string().nullable().optional(),
      buttons: buttonsSchema.default([]),
      isActive: z.boolean().default(true),
    });
    r.post('/api/templates', async (req) => {
      const body = parse(tplSchema, req.body);
      if (body.botId) await ownBot(uid(req), body.botId);
      if (body.mediaId) await ownMedia(uid(req), body.mediaId);
      return prisma.messageTemplate.create({ data: { ...body, ownerId: uid(req), buttons: body.buttons as Prisma.InputJsonValue } });
    });
    r.put<{ Params: { id: string } }>('/api/templates/:id', async (req) => {
      const t = await prisma.messageTemplate.findFirst({ where: { id: req.params.id, ownerId: uid(req) } });
      if (!t) throw notFound();
      const body = parse(tplSchema, req.body);
      if (body.botId) await ownBot(uid(req), body.botId);
      if (body.mediaId) await ownMedia(uid(req), body.mediaId);
      return prisma.messageTemplate.update({ where: { id: t.id }, data: { ...body, buttons: body.buttons as Prisma.InputJsonValue } });
    });
    r.delete<{ Params: { id: string } }>('/api/templates/:id', async (req) => {
      const t = await prisma.messageTemplate.findFirst({ where: { id: req.params.id, ownerId: uid(req) } });
      if (!t) throw notFound();
      await prisma.messageTemplate.delete({ where: { id: t.id } });
      return { ok: true };
    });
    /** Server-side render = exactly what Telegram will receive (sanitized HTML). */
    r.post('/api/templates/render', async (req) => {
      const body = parse(z.object({ text: z.string().max(4096), vars: z.record(z.union([z.string(), z.number()])).optional() }), req.body);
      return { html: renderTemplate(body.text, { ...SAMPLE_VARS, ...(body.vars ?? {}) }) };
    });
    /** Test send of a template to the user's own Telegram (via the chosen bot). */
    r.post('/api/templates/test', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
      const body = parse(z.object({ botId: z.string(), text: z.string().max(4096), mediaId: z.string().nullable().optional(), buttons: buttonsSchema.default([]) }), req.body);
      const bot = await usableBot(uid(req), body.botId);
      const media = body.mediaId ? await ownMedia(uid(req), body.mediaId) : null;
      await sendRich(apiForBot(bot), bot.id, BigInt(req.user!.telegramId), { html: renderTemplate(body.text, SAMPLE_VARS), media, buttons: body.buttons.map((b) => [b]) }).catch((e) => {
        throw badRequest(`Не удалось отправить: ${(e as Error).message}. Сначала напишите боту /start.`);
      });
      return { ok: true };
    });

    // ── Premium emoji ──
    r.get('/api/emoji', async (req) => {
      const q = parse(z.object({ category: z.string().optional(), q: z.string().max(50).optional() }), req.query);
      return prisma.premiumEmoji.findMany({
        where: { isActive: true, ...(q.category ? { category: q.category } : {}), ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}) },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      });
    });

    // ── AI ──
    r.post('/api/ai/generate', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
      const input = parse(
        z.object({
          title: z.string().min(1).max(120),
          prize: z.string().min(1).max(120),
          conditions: z.string().max(1000).optional(),
          date: z.string().max(60).optional(),
          winners: z.number().int().min(1).max(10000).optional(),
          channel: z.string().max(100).optional(),
          extra: z.string().max(1000).optional(),
          tone: z.enum(['hype', 'friendly', 'formal', 'minimal']).optional(),
        }),
        req.body,
      );
      const job = await prisma.aIJob.create({ data: { ownerId: uid(req), kind: 'TEXT', provider: env.AI_PROVIDER, input } });
      await queue(QUEUES.aiContent).add('text', { jobId: job.id } satisfies AIJobPayload, { attempts: 1 });
      await audit('ai.generate', { actorId: uid(req), entity: 'AIJob', entityId: job.id });
      return job;
    });
    r.post('/api/ai/image', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => {
      const input = parse(
        z.object({
          template: z.enum(Object.keys(IMAGE_TEMPLATES) as [keyof typeof IMAGE_TEMPLATES]).default('cartoon'),
          title: z.string().min(1).max(80),
          prize: z.string().min(1).max(60),
          date: z.string().max(60).optional(),
          theme: z.string().max(200).optional(),
          useAi: z.boolean().default(true),
          logoMediaId: z.string().nullable().optional(),
          usePlatformLogo: z.boolean().default(false),
        }),
        req.body,
      );
      if (input.logoMediaId) await ownMedia(uid(req), input.logoMediaId);
      const job = await prisma.aIJob.create({ data: { ownerId: uid(req), kind: 'IMAGE', provider: input.useAi ? env.AI_PROVIDER : 'template', input } });
      await queue(QUEUES.aiImage).add('image', { jobId: job.id } satisfies AIJobPayload, { attempts: 1 });
      return job;
    });
    r.get<{ Params: { id: string } }>('/api/ai/jobs/:id', async (req) => {
      const job = await prisma.aIJob.findFirst({ where: { id: req.params.id, ownerId: uid(req) } });
      if (!job) throw notFound();
      return job;
    });
    r.get('/api/ai/templates', async () => Object.entries(IMAGE_TEMPLATES).map(([id, t]) => ({ id, label: t.label })));
  });
}
