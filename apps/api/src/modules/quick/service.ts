import type { Prisma, TelegramBot } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import type { TelegramApi } from '../../telegram/client.js';
import type { TgMessage } from '../../telegram/types.js';
import { escapeHtml } from '../../templates/render.js';
import { ensureUser, isChatAdmin } from '../chats/access.js';
import { startContest } from '../contests/lifecycle.js';

/**
 * Quick giveaway, randomizer-bot style: one command (or one screen in the app) posts a message with
 * «Участвовать», and after the timer the bot draws the winners. Built on the regular RANDOM contest.
 */
export interface QuickCommand {
  durationSec: number;
  winners: number;
  prize: string;
}

export const QUICK_HELP = `<b>Быстрый розыгрыш</b>

<code>.розыгрыш 10м 2 Новогодний мишка</code>
время — 30с, 10м, 2ч, 1д (по умолчанию 10 минут)
число — сколько победителей (по умолчанию 1)
дальше — приз: название подарка из каталога или любой текст

Под постом появится кнопка «Участвовать», после таймера бот выберет победителей. Запускать могут только админы чата.`;

const UNIT: Record<string, number> = { с: 1, сек: 1, s: 1, м: 60, мин: 60, m: 60, ч: 3600, h: 3600, д: 86400, d: 86400 };

/** `.розыгрыш 10м 2 Мишка` / `/fast 30m Rose` → command; `.розыгрыш` alone → help; anything else → null. */
export function parseQuickCommand(text: string | undefined): QuickCommand | 'help' | null {
  const m = (text ?? '').trim().match(/^[./](?:розыгрыш|рандом|fast|giveaway)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const rest = (m[1] ?? '').trim();
  if (!rest || /^(help|помощь|\?)$/i.test(rest)) return 'help';
  let durationSec = 600;
  let winners = 1;
  const words = rest.split(/\s+/);
  const prize: string[] = [];
  for (const w of words) {
    const d = w.match(/^(\d{1,4})(с|сек|s|м|мин|m|ч|h|д|d)$/i);
    if (d && prize.length === 0) {
      durationSec = Number(d[1]) * UNIT[d[2]!.toLowerCase()]!;
      continue;
    }
    if (/^\d{1,3}$/.test(w) && prize.length === 0) {
      winners = Number(w);
      continue;
    }
    prize.push(w);
  }
  return {
    durationSec: Math.min(7 * 86400, Math.max(30, durationSec)),
    winners: Math.min(100, Math.max(1, winners)),
    prize: prize.join(' ').slice(0, 120) || 'Сюрприз',
  };
}

export function formatDurationRu(sec: number) {
  if (sec % 86400 === 0) return `${sec / 86400} дн.`;
  if (sec % 3600 === 0) return `${sec / 3600} ч`;
  if (sec % 60 === 0) return `${sec / 60} мин`;
  return `${sec} сек`;
}

/**
 * Creates and starts the quick contest. `allowPaidGift`: only the person who pays may turn the prize
 * into a real gift from the catalog; otherwise it stays a text prize handed out manually.
 */
export async function launchQuick(p: {
  bot: TelegramBot;
  ownerId: string;
  chatId?: string | null;
  chatTgId: bigint;
  threadId?: number | null;
  prize: string;
  giftId?: string | null;
  winners: number;
  durationSec: number;
  organizerTgId: bigint;
  allowPaidGift: boolean;
}) {
  const gift = p.allowPaidGift
    ? p.giftId
      ? await prisma.telegramGift.findUnique({ where: { id: p.giftId } })
      : await prisma.telegramGift.findFirst({ where: { name: { equals: p.prize, mode: 'insensitive' }, type: { not: 'REMOVED' } } })
    : null;
  if (gift && gift.type === 'REMOVED') throw new Error(`«${gift.name}» снят с продажи — его нельзя подарить`);
  const prizeTitle = gift?.name ?? p.prize;
  const endsAt = new Date(Date.now() + p.durationSec * 1000);
  const contest = await prisma.contest.create({
    data: {
      ownerId: p.ownerId,
      botId: p.bot.id,
      chatId: p.chatId ?? undefined,
      type: 'RANDOM',
      title: `Розыгрыш: ${prizeTitle}`.slice(0, 120),
      winnersCount: p.winners,
      endsAt,
      targetChatTgId: p.chatTgId,
      threadMessageId: p.threadId ?? null,
      postText: `[[e:🎁]] <b>Быстрый розыгрыш!</b>\n\nПриз: <b>${escapeHtml(prizeTitle)}</b>\nПобедителей: ${p.winners}\nИтоги через ${formatDurationRu(p.durationSec)}\n\nЖми «Участвовать»`,
      config: { quick: true, organizerTgId: p.organizerTgId.toString() } as Prisma.InputJsonValue,
      prizes: {
        create: Array.from({ length: p.winners }, (_, i) =>
          gift ? { kind: 'GIFT' as const, title: gift.name, giftId: gift.id, place: i + 1 } : { kind: 'CUSTOM' as const, title: prizeTitle, place: i + 1 },
        ),
      },
    },
  });
  return startContest(contest.id, p.ownerId, { force: true });
}

/** `.розыгрыш …` typed by a chat admin. */
export async function handleQuickCommand(api: TelegramApi, bot: TelegramBot, msg: TgMessage): Promise<boolean> {
  const cmd = parseQuickCommand(msg.text);
  if (!cmd) return false;
  const reply = (html: string) =>
    api.sendMessage(msg.chat.id, html, { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } }).catch(() => undefined);
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return void (await reply('Быстрый розыгрыш запускается в группе: добавьте бота админом и напишите команду там.')), true;
  if (!msg.from || !(await isChatAdmin(api, msg))) return void (await reply('Запускать розыгрыш могут только администраторы чата.')), true;
  if (cmd === 'help') return void (await reply(QUICK_HELP)), true;

  const actor = await ensureUser(msg.from);
  // who pays: on the shared bot — the admin who launched it (their own Business Stars);
  // on a white-label bot — its owner, so only the owner may give away a paid gift
  const ownerId = bot.ownerId ?? actor.id;
  const allowPaidGift = bot.isPlatform || bot.ownerId === actor.id;
  const chat = await prisma.telegramChat.findUnique({ where: { botId_chatId: { botId: bot.id, chatId: BigInt(msg.chat.id) } } });
  try {
    await launchQuick({
      bot,
      ownerId,
      chatId: chat?.id,
      chatTgId: BigInt(msg.chat.id),
      threadId: msg.message_thread_id ?? null,
      prize: cmd.prize,
      winners: cmd.winners,
      durationSec: cmd.durationSec,
      organizerTgId: BigInt(msg.from.id),
      allowPaidGift,
    });
    await api.deleteMessage(msg.chat.id, msg.message_id).catch(() => undefined); // keep the chat clean: the post is the answer
  } catch (e) {
    await reply(`Не получилось запустить: ${escapeHtml((e as Error).message)}`);
  }
  return true;
}
