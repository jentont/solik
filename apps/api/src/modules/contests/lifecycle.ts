import type { Contest, ContestPrize, TelegramBot } from '@prisma/client';
import { audit, contestEvent } from '../../lib/audit.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { jobId, queue, QUEUES, type ContestJob } from '../../queues/index.js';
import { TelegramError } from '../../telegram/client.js';
import { resolveTemplate, sendRich, sendTemplate } from '../../telegram/messenger.js';
import { apiForBot } from '../../telegram/registry.js';
import { mention, renderTemplate } from '../../templates/render.js';
import { createDeliveriesForDraw } from '../gifts/delivery.js';
import { assertBotUsable } from '../subscriptions/plans.js';
import { drawWinners } from '../winners/engine.js';
import { notifyContestStarted } from '../notify/service.js';
import { scheduleAuctionTimers } from '../auction/timers.js';

export function prizeTitle(prizes: Pick<ContestPrize, 'title'>[]): string {
  return prizes.map((p) => p.title).join(', ') || '—';
}

type FullContest = Contest & { bot: TelegramBot; prizes: ContestPrize[] };

function joinButtonText(c: Contest) {
  return ((c.config as Record<string, unknown>)?.joinButtonText as string) || 'Участвовать';
}

/** Publishes the contest post and activates it (or schedules it for startsAt). */
/** Username shown as the giver («Ты выиграл … от @admin»), from contest config `winFrom`. */
export function winFrom(contest: Pick<Contest, 'config'>): string | null {
  const v = String(((contest.config ?? {}) as Record<string, unknown>).winFrom ?? '').trim().replace(/^@/, '');
  return /^[A-Za-z0-9_]{3,32}$/.test(v) ? `@${v}` : null;
}

export async function startContest(contestId: string, actorId: string | null, opts: { force?: boolean } = {}) {
  const contest = (await prisma.contest.findUniqueOrThrow({
    where: { id: contestId },
    include: { bot: true, prizes: true, postMedia: true, channel: true, chat: true },
  })) as FullContest & { postMedia: any; channel: any; chat: any };
  assertBotUsable(contest.bot);
  if (!['DRAFT', 'SCHEDULED'].includes(contest.status)) throw conflict('Конкурс уже запущен или завершен');
  if (!contest.targetChatTgId) throw badRequest('Не выбран чат или канал для публикации');

  if (!opts.force && contest.startsAt && contest.startsAt.getTime() > Date.now() + 5000) {
    await prisma.contest.update({ where: { id: contestId }, data: { status: 'SCHEDULED' } });
    await queue(QUEUES.contestStart).add('start', { contestId } satisfies ContestJob, {
      delay: contest.startsAt.getTime() - Date.now(),
      jobId: jobId('start', contestId, contest.startsAt.getTime()),
    });
    await contestEvent(contestId, 'contest.scheduled', { startsAt: contest.startsAt });
    return prisma.contest.findUniqueOrThrow({ where: { id: contestId } });
  }

  const api = apiForBot(contest.bot);
  const vars = {
    contest_name: contest.title,
    prize_name: prizeTitle(contest.prizes),
    gift_name: prizeTitle(contest.prizes),
    chat_name: contest.chat?.title ?? contest.channel?.title,
    channel_username: contest.channel?.username ? `@${contest.channel.username}` : '',
    participants_count: 0,
  };

  let publishedMessageId: number | null = contest.publishedMessageId;
  // SMS counters and chat-driven modes may run without a separate post
  const needsPost = !(contest.config as any)?.skipPost && contest.type !== 'SMS_COUNTER';
  if (needsPost && !publishedMessageId) {
    const html = renderTemplate(contest.postText || (await resolveTemplate(contest.ownerId, contest.botId, 'CONTEST_START')).text, vars);
    const buttons: { text: string; url?: string; callback?: string }[] = [];
    if (contest.type === 'RANDOM' || contest.type === 'GIFTS' || contest.type === 'NFT') {
      buttons.push({ text: joinButtonText(contest), callback: `join:${contest.id}` });
    }
    // invoice mode only: in paid-messages mode the bid is the paid message in the chat itself
    if (contest.type === 'STARS_AUCTION' && (contest.config as Record<string, unknown>)?.bidMode !== 'paid_messages') {
      const me = await api.getMe();
      buttons.push({ text: 'Перебить ставку', url: `https://t.me/${me.username}?start=bid_${contest.id}` });
    }
    for (const b of (contest.postButtons as any[]) ?? []) if (b?.text && b?.url) buttons.push({ text: b.text, url: b.url });
    try {
      const msg = await sendRich(api, contest.botId, contest.targetChatTgId, {
        html,
        media: contest.postMedia,
        buttons: buttons.map((b) => [b]),
      });
      publishedMessageId = msg.message_id;
    } catch (e) {
      const reason = e instanceof TelegramError ? e.description : String(e);
      await contestEvent(contestId, 'contest.publish_failed', { reason });
      throw badRequest(`Не удалось опубликовать пост: ${reason}. Проверьте, что бот — администратор с правом публикации.`);
    }
  }

  const now = new Date();
  const config = contest.config as Record<string, any>;
  const data: Record<string, unknown> = { status: 'ACTIVE', startedAt: now, publishedMessageId };
  if (contest.type === 'STARS_AUCTION') {
    const extend = Number(config.extendSeconds ?? 180);
    data.currentBid = null;
    data.endsAt = contest.endsAt && contest.endsAt > now ? contest.endsAt : new Date(now.getTime() + extend * 1000);
  }
  const updated = await prisma.contest.update({ where: { id: contestId }, data });

  // Channel post → discussion thread mapping might already be known
  if (updated.channelId && publishedMessageId) {
    const post = await prisma.channelPost.findUnique({
      where: { channelId_messageId: { channelId: updated.channelId, messageId: publishedMessageId } },
    });
    if (post?.discussionMessageId) {
      await prisma.contest.update({ where: { id: contestId }, data: { threadMessageId: post.discussionMessageId } });
    }
  }

  if (updated.type === 'STARS_AUCTION') await scheduleAuctionTimers(updated.id);
  else if (updated.endsAt) await scheduleContestEnd(updated.id, updated.endsAt);

  await contestEvent(contestId, 'contest.started', { publishedMessageId });
  // tell people active in that chat; a failure here must never block the contest
  await notifyContestStarted(contestId).catch(() => 0);
  await audit('contest.start', { actorId, entity: 'Contest', entityId: contestId });
  return updated;
}

export async function scheduleContestEnd(contestId: string, endsAt: Date) {
  await queue(QUEUES.contestEnd).add('end', { contestId } satisfies ContestJob, {
    delay: Math.max(0, endsAt.getTime() - Date.now()),
    jobId: jobId('end', contestId, endsAt.getTime()),
  });
}

/** Draws winners, announces results, schedules deliveries. Safe to call twice (second call no-ops). */
export async function finishContest(contestId: string, actorId: string | null = null, opts: { reroll?: boolean } = {}) {
  const before = await prisma.contest.findUniqueOrThrow({ where: { id: contestId } });
  if (!opts.reroll && !['ACTIVE', 'DRAWING', 'SCHEDULED'].includes(before.status)) return null;
  const draw = await drawWinners(contestId, { actorId, reroll: opts.reroll });
  await announceResults(contestId, draw.drawNumber);
  await createDeliveriesForDraw(contestId, draw.drawNumber);
  return draw;
}

export async function announceResults(contestId: string, drawNumber: number, opts: { skipChatAnnouncement?: boolean } = {}) {
  const contest = await prisma.contest.findUniqueOrThrow({
    where: { id: contestId },
    include: { bot: true, prizes: true, winners: { where: { drawNumber, status: 'ACTIVE' }, include: { prize: true }, orderBy: { place: 'asc' } } },
  });
  const api = apiForBot(contest.bot);
  const ctx = { ownerId: contest.ownerId, botId: contest.botId };
  const participants =
    contest.type === 'SMS_COUNTER'
      ? (await prisma.smsCounter.findUnique({ where: { contestId } }))?.count ?? 0
      : await prisma.contestParticipant.count({ where: { contestId } });
  const winnersList = contest.winners.length
    ? contest.winners.map((w) => `${w.place}. ${mention({ id: w.tgUserId, username: w.username, first_name: w.firstName })}${w.prize ? ` — ${w.prize.title}` : ''}`).join('\n')
    : 'Нет подходящих участников';

  const owner = contest.ownerId ? await prisma.user.findUnique({ where: { id: contest.ownerId } }) : null;
  const ownerName = winFrom(contest) ?? (owner?.username ? `@${owner.username}` : owner?.firstName ?? '');

  // SMS counters / comment contests: reply directly to each winner's message
  if (contest.type === 'SMS_COUNTER' && contest.targetChatTgId) {
    const counter = await prisma.smsCounter.findUnique({ where: { contestId } });
    for (const w of contest.winners) {
      const entry = counter
        ? await prisma.smsCounterParticipant.findFirst({ where: { counterId: counter.id, tgUserId: w.tgUserId }, orderBy: { position: 'asc' } })
        : null;
      await sendTemplate(
        api,
        ctx,
        contest.targetChatTgId,
        'INSTANT_WIN',
        {
          username: mention({ id: w.tgUserId, username: w.username, first_name: w.firstName }),
          winner_username: mention({ id: w.tgUserId, username: w.username, first_name: w.firstName }),
          prize_name: w.prize?.title ?? prizeTitle(contest.prizes),
          gift_name: w.prize?.title ?? prizeTitle(contest.prizes),
          owner_username: ownerName,
          contest_name: contest.title,
          position: entry?.position,
        },
        entry
          ? { reply_parameters: { message_id: entry.messageId, allow_sending_without_reply: true } }
          : contest.threadMessageId
            ? { reply_parameters: { message_id: contest.threadMessageId, allow_sending_without_reply: true } }
            : {},
      ).catch((e) => contestEvent(contestId, 'announce.failed', { error: String(e) }));
    }
  } else if (contest.targetChatTgId && !opts.skipChatAnnouncement) {
    const key = contest.type === 'STARS_AUCTION' ? 'AUCTION_FINISHED' : 'CONTEST_FINISHED';
    const first = contest.winners[0];
    await sendTemplate(
      api,
      ctx,
      contest.targetChatTgId,
      key,
      {
        contest_name: contest.title,
        prize_name: prizeTitle(contest.prizes),
        winners: winnersList,
        participants_count: participants,
        winner_username: first ? mention({ id: first.tgUserId, username: first.username, first_name: first.firstName }) : '—',
        stars_amount: contest.currentBid ?? '',
        owner_username: ownerName,
      },
      contest.publishedMessageId ? { reply_parameters: { message_id: contest.publishedMessageId, allow_sending_without_reply: true } } : {},
    ).catch((e) => contestEvent(contestId, 'announce.failed', { error: String(e) }));
  }
  for (const w of contest.winners) {
    await sendTemplate(api, ctx, w.tgUserId, 'WINNER', {
      username: mention({ id: w.tgUserId, username: w.username, first_name: w.firstName }),
      first_name: w.firstName,
      user_id: String(w.tgUserId),
      prize_name: w.prize?.title ?? prizeTitle(contest.prizes),
      gift_name: w.prize?.title ?? prizeTitle(contest.prizes),
      contest_name: contest.title,
      position: w.place,
    }).catch(() => undefined); // only possible if the winner started the bot
  }
}

export async function cancelContest(contestId: string, actorId: string | null) {
  const res = await prisma.contest.updateMany({
    where: { id: contestId, status: { in: ['DRAFT', 'SCHEDULED', 'ACTIVE'] } },
    data: { status: 'CANCELLED', finishedAt: new Date(), timerVersion: { increment: 1 } },
  });
  if (!res.count) throw conflict('Конкурс нельзя остановить в текущем состоянии');
  await prisma.smsCounter.updateMany({ where: { contestId, status: { in: ['ACTIVE', 'FILLED'] } }, data: { status: 'STOPPED' } });
  await contestEvent(contestId, 'contest.cancelled');
  await audit('contest.cancel', { actorId, entity: 'Contest', entityId: contestId });
}

/** Registers a participant (RANDOM / GIFTS / NFT contests via the join button). */
export async function joinContest(contestId: string, user: { id: number; username?: string; first_name?: string; is_bot?: boolean }) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId }, include: { bot: true } });
  if (!contest || contest.status !== 'ACTIVE') return { ok: false as const, message: 'Конкурс не активен' };
  if (user.is_bot) return { ok: false as const, message: 'Боты не участвуют' };
  const cfg = contest.config as Record<string, any>;
  if (cfg.ignoreOwner && contest.bot.ownerId) {
    const owner = await prisma.user.findUnique({ where: { id: contest.bot.ownerId } });
    if (owner && Number(owner.telegramId) === user.id) return { ok: false as const, message: 'Организатор не участвует' };
  }
  // Required subscriptions: checked via getChatMember (bot must be admin there)
  const required: string[] = Array.isArray(cfg.requiredChats) ? cfg.requiredChats : [];
  if (required.length) {
    const api = apiForBot(contest.bot);
    for (const chat of required) {
      const m = await api.getChatMember(chat, user.id).catch(() => null);
      if (!m || ['left', 'kicked'].includes(m.status)) return { ok: false as const, message: `Подпишитесь на ${chat}, чтобы участвовать` };
    }
  }
  const existing = await prisma.contestParticipant.findUnique({ where: { contestId_tgUserId: { contestId, tgUserId: BigInt(user.id) } } });
  if (existing) return { ok: true as const, already: true, position: existing.position ?? 0 };
  const p = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Contest" WHERE id = ${contestId} FOR UPDATE`;
    const count = await tx.contestParticipant.count({ where: { contestId } });
    return tx.contestParticipant.upsert({
      where: { contestId_tgUserId: { contestId, tgUserId: BigInt(user.id) } },
      create: { contestId, tgUserId: BigInt(user.id), username: user.username, firstName: user.first_name, position: count + 1 },
      update: {},
    });
  });
  return { ok: true as const, already: false, position: p.position ?? 0 };
}
