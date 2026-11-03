import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { audit, contestEvent } from '../../lib/audit.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { leaderboard } from '../../modules/activity/service.js';
import { cancelContest, finishContest, startContest } from '../../modules/contests/lifecycle.js';
import { assertBotUsable, assertContestLimit } from '../../modules/subscriptions/plans.js';
import { requireAuth, uid } from '../auth.js';
import { assertTgAdmin, ownChannel, ownChat, ownContest, ownMedia, usableBot } from '../ownership.js';
import { pageQuery, parse } from '../validate.js';

const prizeSchema = z.object({
  kind: z.enum(['GIFT', 'STARS', 'NFT', 'PREMIUM', 'CUSTOM']),
  title: z.string().min(1).max(120),
  giftId: z.string().optional(),
  nftAssetId: z.string().optional(),
  businessOwnedGiftId: z.string().optional(),
  starsAmount: z.number().int().min(1).max(1_000_000).optional(),
  premiumMonths: z.number().int().optional(),
  quantity: z.number().int().min(1).max(1000).default(1),
  weight: z.number().int().min(0).max(100000).optional(),
  place: z.number().int().min(1).optional(),
  position: z.number().int().min(1).optional(),
});

const contestTypes = ['RANDOM', 'STARS_AUCTION', 'FIRST_COMMENT', 'SMS_COUNTER', 'MESSAGE_GIVEAWAY', 'ACTIVITY', 'GIFTS', 'NFT', 'DICE_777'] as const;

const contestSchema = z.object({
  botId: z.string(),
  chatId: z.string().optional(),
  channelId: z.string().optional(),
  channelPostId: z.number().int().positive().optional(), // existing channel post (First Comment)
  type: z.enum(contestTypes),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  config: z.record(z.unknown()).default({}),
  winnersCount: z.number().int().min(1).max(10_000).default(1),
  startsAt: z.coerce.date().optional().nullable(),
  endsAt: z.coerce.date().optional().nullable(),
  postText: z.string().max(4096).optional().nullable(),
  postMediaId: z.string().optional().nullable(),
  postButtons: z.array(z.object({ text: z.string().min(1).max(64), url: z.string().url() })).max(6).optional(),
  prizes: z.array(prizeSchema).max(100).default([]),
});

async function validatePrizes(userId: string, prizes: z.infer<typeof prizeSchema>[]) {
  for (const p of prizes) {
    if (p.kind === 'GIFT' && !p.giftId && !p.businessOwnedGiftId) throw badRequest(`Выберите подарок для приза «${p.title}»`);
    if (p.giftId && !(await prisma.telegramGift.findUnique({ where: { id: p.giftId } }))) throw badRequest('Подарок не найден в каталоге');
    if (p.nftAssetId && !(await prisma.nFTAsset.findFirst({ where: { id: p.nftAssetId, ownerId: userId } }))) throw badRequest('NFT не найден');
    if (p.businessOwnedGiftId && !(await prisma.businessOwnedGift.findFirst({ where: { id: p.businessOwnedGiftId, connection: { ownerId: userId } } })))
      throw badRequest('Подарок Business-аккаунта не найден');
    if (p.kind === 'STARS' && !p.starsAmount) throw badRequest('Укажите количество Stars');
  }
}

/** Re-check admin rights right before a contest goes live in its chat/channel. */
async function assertContestAdmin(contestId: string, userTgId: string | number | bigint) {
  const c = await prisma.contest.findUniqueOrThrow({ where: { id: contestId }, include: { bot: true, chat: true, channel: true } });
  if (c.channel) await assertTgAdmin(c.bot, c.channel.chatId, userTgId, `канале «${c.channel.title}»`);
  else if (c.chat) await assertTgAdmin(c.bot, c.chat.chatId, userTgId, `чате «${c.chat.title}»`);
}

async function resolveTarget(userId: string, userTgId: string | number | bigint, body: z.infer<typeof contestSchema>) {
  const bot = await usableBot(userId, body.botId);
  const chat = body.chatId ? await ownChat(userId, body.chatId) : null;
  const channel = body.channelId ? await ownChannel(userId, body.channelId) : null;
  if (chat && chat.botId !== bot.id) throw badRequest('Чат подключен к другому боту');
  if (channel && channel.botId !== bot.id) throw badRequest('Канал подключен к другому боту');
  if (!chat && !channel) throw badRequest('Выберите чат или канал');
  if (channel) await assertTgAdmin(bot, channel.chatId, userTgId, `канале «${channel.title}»`);
  if (chat) await assertTgAdmin(bot, chat.chatId, userTgId, `чате «${chat.title}»`);

  const needsGroup = ['MESSAGE_GIVEAWAY', 'ACTIVITY', 'DICE_777', 'SMS_COUNTER'].includes(body.type);
  if (needsGroup && !chat) throw badRequest('Этот тип конкурса работает в группе — выберите чат');
  if (body.type === 'FIRST_COMMENT' && !channel) throw badRequest('Для «Первого комментария» выберите канал');
  if (body.type === 'FIRST_COMMENT' && channel && !channel.discussionChatId)
    throw badRequest('У канала нет подключенной группы обсуждения. Добавьте бота администратором в группу комментариев.');

  let threadMessageId: number | null = null;
  let publishedMessageId: number | null = null;
  if (body.channelPostId && channel) {
    const post = await prisma.channelPost.findUnique({ where: { channelId_messageId: { channelId: channel.id, messageId: body.channelPostId } } });
    if (!post) throw badRequest('Публикация не найдена. Бот видит только посты, вышедшие после его добавления в канал.');
    publishedMessageId = post.messageId;
    threadMessageId = post.discussionMessageId;
  }
  return {
    bot,
    chat,
    channel,
    targetChatTgId: (channel?.chatId ?? chat?.chatId)!,
    threadMessageId,
    publishedMessageId,
  };
}

export async function contestRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/contests', async (req) => {
    const q = parse(pageQuery.extend({ status: z.string().optional(), type: z.string().optional(), botId: z.string().optional() }), req.query);
    const where: Prisma.ContestWhereInput = {
      ownerId: uid(req),
      ...(q.status ? { status: { in: q.status.split(',') as any } } : {}),
      ...(q.type ? { type: q.type as any } : {}),
      ...(q.botId ? { botId: q.botId } : {}),
      ...(q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.contest.findMany({
        where,
        include: {
          prizes: { include: { gift: true } },
          bot: { select: { id: true, username: true, isPlatform: true } },
          chat: { select: { title: true } },
          channel: { select: { title: true } },
          _count: { select: { participants: true, winners: true } },
          smsCounter: { select: { count: true, target: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.contest.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  app.post('/api/contests', async (req) => {
    const userId = uid(req);
    const body = parse(contestSchema, req.body);
    const t = await resolveTarget(userId, req.user!.telegramId, body);
    assertBotUsable(t.bot);
    await assertContestLimit(userId);
    await validatePrizes(userId, body.prizes);
    if (body.postMediaId) await ownMedia(userId, body.postMediaId);
    if (body.type === 'SMS_COUNTER') throw badRequest('SMS-конкурс создаётся через раздел SMS Counter или командой .sms');
    const config = { ...body.config, ...(t.publishedMessageId ? { skipPost: true } : {}) };
    const contest = await prisma.contest.create({
      data: {
        ownerId: userId,
        botId: t.bot.id,
        chatId: t.chat?.id,
        channelId: t.channel?.id,
        type: body.type,
        title: body.title,
        description: body.description,
        config: config as Prisma.InputJsonValue,
        winnersCount: body.type === 'MESSAGE_GIVEAWAY' && body.config.trigger === 'chance' ? 1_000_000 : body.winnersCount,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        postText: body.postText,
        postMediaId: body.postMediaId,
        postButtons: body.postButtons,
        targetChatTgId: t.targetChatTgId,
        publishedMessageId: t.publishedMessageId,
        threadMessageId: t.threadMessageId,
        prizes: { create: body.prizes },
      },
      include: { prizes: true },
    });
    await contestEvent(contest.id, 'contest.created');
    await audit('contest.create', { actorId: userId, entity: 'Contest', entityId: contest.id, meta: { type: contest.type } });
    return contest;
  });

  app.patch<{ Params: { id: string } }>('/api/contests/:id', async (req) => {
    const userId = uid(req);
    const c = await ownContest(userId, req.params.id);
    if (c.status !== 'DRAFT' && c.status !== 'SCHEDULED') throw conflict('Изменять можно только черновик или запланированный конкурс');
    const body = parse(contestSchema.partial().omit({ botId: true, type: true }), req.body);
    if (body.prizes) await validatePrizes(userId, body.prizes);
    if (body.postMediaId) await ownMedia(userId, body.postMediaId);
    return prisma.$transaction(async (tx) => {
      if (body.prizes) {
        await tx.contestPrize.deleteMany({ where: { contestId: c.id } });
        await tx.contestPrize.createMany({ data: body.prizes.map((p) => ({ ...p, contestId: c.id })) });
      }
      return tx.contest.update({
        where: { id: c.id },
        data: {
          title: body.title,
          description: body.description,
          config: body.config as Prisma.InputJsonValue | undefined,
          winnersCount: body.winnersCount,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          postText: body.postText,
          postMediaId: body.postMediaId,
          postButtons: body.postButtons,
        },
        include: { prizes: true },
      });
    });
  });

  app.get<{ Params: { id: string } }>('/api/contests/:id', async (req) => {
    await ownContest(uid(req), req.params.id);
    const c = await prisma.contest.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        prizes: { include: { gift: true, nftAsset: true } },
        bot: { select: { id: true, username: true, name: true, isPlatform: true, status: true } },
        chat: true,
        channel: true,
        postMedia: true,
        smsCounter: true,
        winners: { include: { prize: true }, orderBy: [{ drawNumber: 'desc' }, { place: 'asc' }] },
        deliveries: { orderBy: { createdAt: 'desc' } },
        events: { orderBy: { createdAt: 'desc' }, take: 100 },
        _count: { select: { participants: true } },
      },
    });
    const bids = c.type === 'STARS_AUCTION'
      ? await prisma.starsTransaction.findMany({ where: { contestId: c.id, status: { in: ['APPLIED', 'REFUNDED'] } }, orderBy: { createdAt: 'desc' }, take: 100 })
      : [];
    return { ...c, bids };
  });

  app.post<{ Params: { id: string } }>('/api/contests/:id/start', async (req) => {
    const own = await ownContest(uid(req), req.params.id);
    await assertContestAdmin(own.id, req.user!.telegramId);
    const { now } = parse(z.object({ now: z.boolean().optional() }), req.body ?? {});
    return startContest(req.params.id, uid(req), { force: now });
  });

  /** «Продолжить» after the anti-spam guard froze the contest (same as the button in the bot). */
  app.post<{ Params: { id: string } }>('/api/contests/:id/resume', async (req) => {
    await ownContest(uid(req), req.params.id);
    const { resumeContest } = await import('../../modules/guard/service.js');
    return { released: await resumeContest(req.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/contests/:id/stop', async (req) => {
    await ownContest(uid(req), req.params.id);
    await cancelContest(req.params.id, uid(req));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/contests/:id/winner', async (req) => {
    const c = await ownContest(uid(req), req.params.id);
    const { reroll } = parse(z.object({ reroll: z.boolean().optional() }), req.body ?? {});
    if (c.type === 'SMS_COUNTER') await prisma.smsCounter.updateMany({ where: { contestId: c.id }, data: { status: 'FINISHED', finishedAt: new Date() } });
    const draw = await finishContest(c.id, uid(req), { reroll });
    if (!draw) throw conflict('Победители уже определены — используйте повторный розыгрыш');
    return draw;
  });

  app.post<{ Params: { id: string } }>('/api/contests/:id/archive', async (req) => {
    const c = await ownContest(uid(req), req.params.id);
    if (['ACTIVE', 'SCHEDULED'].includes(c.status)) throw conflict('Сначала завершите конкурс');
    return prisma.contest.update({ where: { id: c.id }, data: { status: 'ARCHIVED' } });
  });

  app.delete<{ Params: { id: string } }>('/api/contests/:id', async (req) => {
    const c = await ownContest(uid(req), req.params.id);
    if (c.status !== 'DRAFT') throw conflict('Удалить можно только черновик; завершённые конкурсы архивируются');
    await prisma.contest.delete({ where: { id: c.id } });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/contests/:id/participants', async (req) => {
    const c = await ownContest(uid(req), req.params.id);
    const q = parse(pageQuery, req.query);
    if (c.type === 'SMS_COUNTER') {
      const counter = await prisma.smsCounter.findUnique({ where: { contestId: c.id } });
      const where = { counterId: counter?.id ?? '' };
      const [items, total] = await Promise.all([
        prisma.smsCounterParticipant.findMany({ where, orderBy: { position: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        prisma.smsCounterParticipant.count({ where }),
      ]);
      return { items, total };
    }
    const where = { contestId: c.id, ...(q.q ? { username: { contains: q.q, mode: 'insensitive' as const } } : {}) };
    const [items, total] = await Promise.all([
      prisma.contestParticipant.findMany({ where, orderBy: [{ position: 'asc' }, { score: 'desc' }, { joinedAt: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.contestParticipant.count({ where }),
    ]);
    return { items, total };
  });

  app.get<{ Params: { id: string } }>('/api/contests/:id/leaderboard', async (req) => {
    await ownContest(uid(req), req.params.id);
    return leaderboard(req.params.id, 50);
  });

  app.get('/api/winners', async (req) => {
    const q = parse(pageQuery, req.query);
    const where = { contest: { ownerId: uid(req) } };
    const [items, total] = await Promise.all([
      prisma.contestWinner.findMany({
        where,
        include: { prize: true, contest: { select: { id: true, title: true, type: true } }, deliveries: { select: { status: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.contestWinner.count({ where }),
    ]);
    return { items, total };
  });

  // ── SMS Counter from the panel (same engine as the `.sms` command) ──
  app.post('/api/sms-counter/start', async (req) => {
    const userId = uid(req);
    const body = parse(
      z.object({
        botId: z.string(),
        chatId: z.string(),
        channelPostId: z.number().int().optional(),
        mode: z.enum(['FIRST_N_USERS', 'FIRST_N_MESSAGES', 'EVERY_NTH', 'FIRST_COMMENT']),
        target: z.number().int().min(1).max(100_000),
        everyN: z.number().int().min(2).max(10_000).optional(),
        announceEvery: z.number().int().min(1).max(1000).default(1),
        prizes: z.array(prizeSchema).max(100).default([]),
        title: z.string().max(120).optional(),
      }),
      req.body,
    );
    const bot = await usableBot(userId, body.botId);
    assertBotUsable(bot);
    const chat = await ownChat(userId, body.chatId);
    if (chat.botId !== bot.id) throw badRequest('Чат подключен к другому боту');
    await assertTgAdmin(bot, chat.chatId, req.user!.telegramId, `чате «${chat.title}»`);
    await validatePrizes(userId, body.prizes);
    if (body.mode === 'EVERY_NTH' && !body.everyN) throw badRequest('Укажите шаг N');

    let thread: number | null = null;
    if (body.channelPostId) {
      const post = await prisma.channelPost.findFirst({ where: { messageId: body.channelPostId, channel: { discussionChatId: chat.id } } });
      if (!post?.discussionMessageId) throw badRequest('Не найдена ветка комментариев этого поста. Убедитесь, что бот — администратор группы обсуждения.');
      thread = post.discussionMessageId;
    }
    const busy = await prisma.smsCounter.findFirst({ where: { botId: bot.id, chatTgId: chat.chatId, threadMessageId: thread, status: { in: ['ACTIVE', 'FILLED'] } } });
    if (busy) throw conflict('В этом чате уже идёт SMS-конкурс');

    const contest = await prisma.contest.create({
      data: {
        ownerId: userId,
        botId: bot.id,
        chatId: chat.id,
        type: 'SMS_COUNTER',
        status: 'ACTIVE',
        startedAt: new Date(),
        title: body.title || `SMS: первые ${body.target}`,
        winnersCount: body.prizes.filter((p) => p.position).length || Math.max(1, body.prizes.reduce((s, p) => s + p.quantity, 0)),
        targetChatTgId: chat.chatId,
        threadMessageId: thread,
        config: { mode: body.mode, target: body.target, everyN: body.everyN ?? null, source: 'panel' },
        prizes: { create: body.prizes },
        smsCounter: {
          create: { botId: bot.id, chatTgId: chat.chatId, threadMessageId: thread, mode: body.mode, target: body.target, everyN: body.everyN, announceEvery: body.announceEvery, startedByTgId: BigInt(req.user!.telegramId) },
        },
      },
      include: { prizes: true, smsCounter: true },
    });
    const { sendTemplate } = await import('../../telegram/messenger.js');
    const { apiForBot } = await import('../../telegram/registry.js');
    const { prizeTitle } = await import('../../modules/contests/lifecycle.js');
    await sendTemplate(apiForBot(bot), { ownerId: userId, botId: bot.id }, chat.chatId, 'SMS_STARTED', {
      target: body.target,
      prize_name: prizeTitle(contest.prizes),
      participants_count: 0,
      contest_name: contest.title,
    }, thread ? { reply_parameters: { message_id: thread, allow_sending_without_reply: true } } : {});
    await audit('sms.start', { actorId: userId, entity: 'Contest', entityId: contest.id });
    return contest;
  });

  app.post('/api/sms-counter/stop', async (req) => {
    const { contestId } = parse(z.object({ contestId: z.string() }), req.body);
    await ownContest(uid(req), contestId);
    await prisma.smsCounter.updateMany({ where: { contestId }, data: { status: 'STOPPED', finishedAt: new Date() } });
    await cancelContest(contestId, uid(req)).catch(() => undefined);
    return { ok: true };
  });

  app.get('/api/sms-counter/stats', async (req) => {
    const userId = uid(req);
    const counters = await prisma.smsCounter.findMany({
      where: { contest: { ownerId: userId } },
      include: { contest: { select: { id: true, title: true, status: true, chat: { select: { title: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const totals = await prisma.smsCounterParticipant.count({ where: { counter: { contest: { ownerId: userId } } } });
    return { counters, totals: { counters: counters.length, active: counters.filter((c) => c.status === 'ACTIVE').length, participants: totals } };
  });
}
