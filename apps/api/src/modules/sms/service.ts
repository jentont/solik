import type { SmsCounter, SmsMode, TelegramBot } from '@prisma/client';
import { audit, contestEvent } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { queue, QUEUES, type NotificationJob } from '../../queues/index.js';
import type { TelegramApi } from '../../telegram/client.js';
import { resolveTemplate, sendTemplate } from '../../telegram/messenger.js';
import type { TgMessage } from '../../telegram/types.js';
import { escapeHtml, mention, renderTemplate } from '../../templates/render.js';
import { finishContest, prizeTitle } from '../contests/lifecycle.js';
import { isChatAdmin, resolveChatOwner } from '../chats/access.js';
import { assertBotUsable } from '../subscriptions/plans.js';
import { decideRegistration, parseSmsCommand, SMS_HELP } from './parser.js';

const MODE_LABEL: Record<SmsMode, string> = {
  FIRST_N_USERS: 'Первые {n} уникальных участников',
  FIRST_N_MESSAGES: 'Первые {n} сообщений',
  EVERY_NTH: 'Каждый {every}-й комментарий ({n} мест)',
  FIRST_COMMENT: 'Первый комментарий',
};

/** The thread a message belongs to when written in a channel discussion group. */
export function threadOf(msg: TgMessage): number | null {
  if (msg.message_thread_id) return msg.message_thread_id;
  if (msg.reply_to_message?.is_automatic_forward) return msg.reply_to_message.message_id;
  return null;
}

async function activeCounter(botId: string, chatTgId: bigint, thread: number | null) {
  return prisma.smsCounter.findFirst({
    where: { botId, chatTgId, status: { in: ['ACTIVE', 'FILLED'] }, threadMessageId: thread },
    orderBy: { createdAt: 'desc' },
    include: { contest: { include: { prizes: true } } },
  });
}

function notify(job: NotificationJob) {
  return queue(QUEUES.notification).add('send', job);
}

export async function handleSmsCommand(api: TelegramApi, bot: TelegramBot, msg: TgMessage): Promise<boolean> {
  const cmd = parseSmsCommand(msg.text);
  if (!cmd) return false;
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    await api.sendMessage(msg.chat.id, 'SMS Counter работает в группах и группах обсуждения каналов. Добавьте бота в чат администратором.');
    return true;
  }
  const reply = (html: string, extra: Record<string, unknown> = {}) =>
    api.sendMessage(msg.chat.id, html, { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true }, ...extra });

  if (!(await isChatAdmin(api, msg))) {
    await reply('Команды SMS Counter доступны только администраторам чата.');
    return true;
  }
  if (cmd.action === 'help') return reply(SMS_HELP).then(() => true);
  if (cmd.action === 'invalid') return reply(escapeHtml(cmd.error)).then(() => true);

  const chatTgId = BigInt(msg.chat.id);
  const thread = threadOf(msg);
  const current = await activeCounter(bot.id, chatTgId, thread);

  switch (cmd.action) {
    case 'start': {
      try {
        assertBotUsable(bot);
      } catch (e) {
        return reply(escapeHtml((e as Error).message)).then(() => true);
      }
      if (current) return reply('В этом чате уже идёт SMS-конкурс. Остановите его: <code>.sms stop</code>').then(() => true);
      const ownerId = await resolveChatOwner(bot, msg.chat.id, msg.from);
      if (!ownerId) return reply('Не удалось определить владельца чата. Подключите чат в панели управления.').then(() => true);
      const chat = await prisma.telegramChat.findUnique({ where: { botId_chatId: { botId: bot.id, chatId: chatTgId } } });
      if (thread === null && chat?.linkedChannelChatId && msg.chat.type === 'supergroup') {
        // Group of a channel without a thread: counts group messages, which is allowed; make it explicit.
      }
      // prize presets belong to a white-label bot's owner; the shared bot has none for random chats
      const settings = (bot.isPlatform ? {} : (bot.settings ?? {})) as { smsPrizeQueue?: { position: number; title: string; giftId?: string }[] };
      const defaultGift = !bot.isPlatform && bot.defaultPrizeId ? await prisma.telegramGift.findUnique({ where: { id: bot.defaultPrizeId } }) : null;
      const prizes = settings.smsPrizeQueue?.length
        ? settings.smsPrizeQueue.map((p) => ({ kind: p.giftId ? ('GIFT' as const) : ('CUSTOM' as const), title: p.title, giftId: p.giftId, position: p.position }))
        : defaultGift
          ? [{ kind: 'GIFT' as const, title: defaultGift.name, giftId: defaultGift.id }]
          : [];

      const contest = await prisma.contest.create({
        data: {
          ownerId,
          botId: bot.id,
          chatId: chat?.id,
          type: 'SMS_COUNTER',
          status: 'ACTIVE',
          startedAt: new Date(),
          title: `SMS: ${MODE_LABEL[cmd.mode].replace('{n}', String(cmd.target)).replace('{every}', String(cmd.everyN ?? ''))}`,
          winnersCount: prizes.filter((p) => 'position' in p && p.position).length || 1,
          targetChatTgId: chatTgId,
          threadMessageId: thread,
          config: { mode: cmd.mode, target: cmd.target, everyN: cmd.everyN ?? null, source: 'command' },
          prizes: { create: prizes },
          smsCounter: {
            create: { botId: bot.id, chatTgId, threadMessageId: thread, mode: cmd.mode, target: cmd.target, everyN: cmd.everyN, startedByTgId: BigInt(msg.from?.id ?? 0) },
          },
        },
        include: { prizes: true },
      });
      await contestEvent(contest.id, 'sms.started', { by: msg.from?.id, thread });
      await audit('sms.start', { entity: 'Contest', entityId: contest.id, meta: { chat: msg.chat.id, mode: cmd.mode, target: cmd.target } });
      await sendTemplate(
        api,
        { ownerId, botId: bot.id },
        msg.chat.id,
        'SMS_STARTED',
        { target: cmd.target, prize_name: prizeTitle(contest.prizes), participants_count: 0, contest_name: contest.title, chat_name: msg.chat.title },
        { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } },
      );
      return true;
    }
    case 'stop': {
      if (!current) return reply('Нет активного SMS-конкурса.').then(() => true);
      await prisma.smsCounter.update({ where: { id: current.id }, data: { status: 'STOPPED', finishedAt: new Date() } });
      await prisma.contest.update({ where: { id: current.contestId }, data: { status: 'CANCELLED', finishedAt: new Date() } });
      await contestEvent(current.contestId, 'sms.stopped', { by: msg.from?.id });
      return reply(`SMS-конкурс остановлен. Участников: ${current.count}/${current.target}.`).then(() => true);
    }
    case 'stats': {
      if (!current) return reply('Нет активного SMS-конкурса.').then(() => true);
      const last = await prisma.smsCounterParticipant.findMany({ where: { counterId: current.id }, orderBy: { position: 'desc' }, take: 5 });
      const lines = last.map((p) => `#${p.position} — ${escapeHtml(mention({ id: p.tgUserId, username: p.username, first_name: p.firstName }))}`);
      return reply(
        `<b>SMS Counter</b>\nРежим: ${MODE_LABEL[current.mode].replace('{n}', String(current.target)).replace('{every}', String(current.everyN ?? ''))}\nУчастники: ${current.count}/${current.target}\nСообщений учтено: ${current.messagesSeen}\nСтатус: ${current.status === 'FILLED' ? 'набор завершён' : 'идёт набор'}\n\n${lines.join('\n')}`,
      ).then(() => true);
    }
    case 'winner': {
      if (!current) return reply('Нет активного SMS-конкурса.').then(() => true);
      if (current.count === 0) return reply('Пока нет участников.').then(() => true);
      await prisma.smsCounter.update({ where: { id: current.id }, data: { status: 'FINISHED', finishedAt: new Date() } });
      await finishContest(current.contestId);
      return true;
    }
    case 'reset': {
      if (!current) return reply('Нет активного SMS-конкурса.').then(() => true);
      await reply(`Сбросить счётчик? Будут удалены ${current.count} участников текущего набора.`, {
        reply_markup: { inline_keyboard: [[{ text: 'Да, сбросить', callback_data: `smsreset:${current.id}` }, { text: 'Отмена', callback_data: 'noop' }]] },
      });
      return true;
    }
  }
  return true;
}

export async function confirmSmsReset(api: TelegramApi, counterId: string, msg: TgMessage, byUserId: number) {
  const fakeMsg = { ...msg, from: { id: byUserId, is_bot: false, first_name: '' }, sender_chat: undefined } as TgMessage;
  if (!(await isChatAdmin(api, fakeMsg))) return 'Только администраторы';
  await prisma.$transaction([
    prisma.smsCounterParticipant.deleteMany({ where: { counterId } }),
    prisma.smsCounter.update({ where: { id: counterId }, data: { count: 0, messagesSeen: 0, status: 'ACTIVE' } }),
  ]);
  const c = await prisma.smsCounter.findUniqueOrThrow({ where: { id: counterId } });
  await contestEvent(c.contestId, 'sms.reset', { by: byUserId });
  await api.editMessageText(msg.chat.id, msg.message_id, 'Счётчик сброшен. Набор начинается заново.').catch(() => undefined);
  return 'Сброшено';
}

/**
 * Counts a message for an active counter. Serialized per counter by a row lock, so
 * positions are strictly sequential and unique even under concurrent webhooks.
 */
export async function handleSmsMessage(bot: TelegramBot, msg: TgMessage): Promise<boolean> {
  if (!msg.from || msg.from.is_bot || msg.sender_chat || msg.is_automatic_forward) return false;
  if (!msg.text && !msg.caption && !msg.animation && !msg.photo) return false;
  if ((msg.text ?? '').startsWith('.sms') || (msg.text ?? '').startsWith('/')) return false;
  const chatTgId = BigInt(msg.chat.id);
  const thread = threadOf(msg);
  const counter = await prisma.smsCounter.findFirst({
    where: { botId: bot.id, chatTgId, status: 'ACTIVE', threadMessageId: thread },
  });
  if (!counter) return false;

  // anti-spam: one counted message per user per second
  const rl = await redis().set(`sms:rl:${counter.id}:${msg.from.id}`, '1', 'PX', 1000, 'NX');
  if (rl === null && counter.mode === 'FIRST_N_MESSAGES') return false;

  const from = msg.from;
  const result = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<SmsCounter[]>`SELECT * FROM "SmsCounter" WHERE id = ${counter.id} FOR UPDATE`;
    if (!locked || locked.status !== 'ACTIVE') return null;
    const already = !!(await tx.smsCounterParticipant.findFirst({ where: { counterId: counter.id, tgUserId: BigInt(from.id) }, select: { id: true } }));
    const d = decideRegistration(locked, already);
    if (!d.register) {
      await tx.smsCounter.update({ where: { id: counter.id }, data: { messagesSeen: d.messagesSeen } });
      return null;
    }
    const position = locked.count + 1;
    await tx.smsCounterParticipant.create({
      data: { counterId: counter.id, tgUserId: BigInt(from.id), username: from.username, firstName: from.first_name, position, messageId: msg.message_id },
    });
    const filled = position >= locked.target;
    const updated = await tx.smsCounter.update({
      where: { id: counter.id },
      data: { count: position, messagesSeen: d.messagesSeen, status: filled ? 'FILLED' : 'ACTIVE' },
    });
    return { position, filled, updated };
  });
  if (!result) return true;

  const contest = await prisma.contest.findUniqueOrThrow({ where: { id: counter.contestId }, include: { prizes: true } });
  const ctx = { ownerId: contest.ownerId, botId: bot.id };
  const positionPrize = contest.prizes.find((p) => p.position === result.position);
  const vars = {
    username: mention(from),
    first_name: from.first_name,
    user_id: String(from.id),
    position: result.position,
    remaining_slots: counter.target - result.position,
    participants_count: result.position,
    target: counter.target,
    prize_name: positionPrize?.title ?? prizeTitle(contest.prizes),
    contest_name: contest.title,
  };
  const regTpl = await resolveTemplate(ctx.ownerId, ctx.botId, 'SMS_REGISTERED');
  let html = renderTemplate(regTpl.text, vars);
  if (positionPrize) html += `\nПриз за позицию #${result.position}: <b>${escapeHtml(positionPrize.title)}</b>`;
  if (result.position % Math.max(1, counter.announceEvery) === 0 || positionPrize) {
    await notify({ botId: bot.id, chatId: String(msg.chat.id), html, replyTo: msg.message_id });
  }
  if (result.filled) {
    const filledTpl = await resolveTemplate(ctx.ownerId, ctx.botId, 'SMS_FILLED');
    await notify({ botId: bot.id, chatId: String(msg.chat.id), html: renderTemplate(filledTpl.text, vars) });
    await contestEvent(contest.id, 'sms.filled', { count: result.position });
    // single-winner "first comment" and prize-queue counters resolve automatically
    if (counter.mode === 'FIRST_COMMENT' || contest.prizes.some((p) => p.position)) {
      await prisma.smsCounter.update({ where: { id: counter.id }, data: { status: 'FINISHED', finishedAt: new Date() } });
      await finishContest(contest.id);
    }
  }
  return true;
}
