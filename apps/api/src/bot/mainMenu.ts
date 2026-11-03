import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, platformOwnerIds } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { TelegramError, type TelegramApi } from '../telegram/client.js';
import { packEmoji } from '../telegram/emojiPack.js';
import type { TgCallbackQuery, TgInlineButton, TgMessage, TgUser } from '../telegram/types.js';
import { escapeHtml } from '../templates/render.js';
import { ensureUser } from '../modules/chats/access.js';
import { connectBot, TOKEN_RE } from '../modules/bots/service.js';
import { createSubscriptionInvoice } from '../modules/subscriptions/service.js';
import { ensureDefaultPlan } from '../modules/subscriptions/plans.js';

const WELCOME = `<b>Добро пожаловать в SOLIK!</b>

Конкурсы, Telegram-подарки и Stars для вашего канала и чата — без программирования.

Нажмите «Создать свой конкурс», чтобы запустить розыгрыш, или «Создать бота», чтобы получить своего бота под вашим брендом.`;

const app = (p = '') => `${env.WEB_APP_URL.replace(/\/$/, '')}${p}`;
const BANNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/welcome.png');

function pick(e: { byChar: Map<string, string>; all: string[] }, chars: string[], fallbackIndex: number) {
  for (const ch of chars) {
    const id = e.byChar.get(ch);
    if (id) return id;
  }
  return e.all[fallbackIndex];
}

async function mainKeyboard(api: TelegramApi): Promise<TgInlineButton[][]> {
  const e = await packEmoji(api);
  const contestIcon = pick(e, ['🎁', '🏆', '🎉', '🎄', '⭐'], 0);
  const botIcon = pick(e, ['🤖', '⛄', '❄', '✨', '🎅'], 1);
  return [
    [{ text: 'Создать свой конкурс', web_app: { url: app('/contests/new') }, style: 'primary', ...(contestIcon ? { icon_custom_emoji_id: contestIcon } : {}) }],
    [{ text: 'Создать бота', callback_data: 'm:newbot', style: 'success', ...(botIcon ? { icon_custom_emoji_id: botIcon } : {}) }],
  ];
}

/** Banner + two buttons. Falls back to plain buttons / text if Telegram rejects icons or the photo. */
async function sendWelcome(api: TelegramApi, chatId: number) {
  const rows = await mainKeyboard(api);
  const plain = rows.map((r) => r.map(({ icon_custom_emoji_id: _i, style: _s, ...b }) => b));
  const cached = await redis().get('main:welcome_photo:winter3');
  const send = async (inline_keyboard: TgInlineButton[][]) => {
    if (cached) return api.sendPhoto(chatId, cached, WELCOME, { reply_markup: { inline_keyboard } });
    const data = await readFile(BANNER);
    const msg = await api.upload<TgMessage & { photo?: { file_id: string }[] }>('sendPhoto', 'photo', { data, filename: 'solik.png', mime: 'image/png' }, {
      chat_id: chatId,
      caption: WELCOME,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard },
    });
    const fileId = msg.photo?.at(-1)?.file_id;
    if (fileId) await redis().set('main:welcome_photo:winter3', fileId);
    return msg;
  };
  try {
    return await send(rows);
  } catch (err) {
    if (err instanceof TelegramError && err.code === 400) {
      try {
        return await send(plain);
      } catch {
        /* fall through to text */
      }
    }
    return api.sendMessage(chatId, WELCOME, { reply_markup: { inline_keyboard: plain } });
  }
}

const HELP = `<b>Как начать</b>

<b>Бесплатно:</b> добавьте этого бота администратором в свой чат или канал — он появится в панели, и можно запускать конкурсы.

<b>Свой бот (White-Label):</b> «Создать бота» → оплата подписки в Stars → токен от @BotFather. Бот будет выглядеть как ваш собственный продукт.

<b>Быстрый розыгрыш в чате:</b> <code>.розыгрыш 10м 2 Новогодний мишка</code> — пост с кнопкой «Участвовать», итоги по таймеру.

<b>SMS Counter в чате:</b> <code>.sms 100</code> — первые 100 участников, <code>.sms help</code> — все команды.

Вся настройка — в панели (кнопка «Открыть» внизу).`;

export async function handleMainPrivate(api: TelegramApi, msg: TgMessage) {
  const from = msg.from!;
  await ensureUser(from);
  const text = (msg.text ?? '').trim();

  // Waiting for a BotFather token after "Создать бота"
  const state = await redis().get(`conv:${from.id}`);
  if (state === 'await_token' && TOKEN_RE.test(text)) {
    await redis().del(`conv:${from.id}`);
    await api.deleteMessage(msg.chat.id, msg.message_id).catch(() => undefined); // don't leave the token in chat history
    const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(from.id) } });
    try {
      const res = await connectBot(user.id, text);
      await api.sendMessage(
        msg.chat.id,
        `Бот @${escapeHtml(String(res.bot.username))} подключен!\n\nДобавьте его администратором в свой чат или канал и настройте внешний вид в панели.`,
        { reply_markup: { inline_keyboard: [[{ text: 'Открыть панель бота', web_app: { url: app(`/bots/${res.bot.id}`) } }]] } },
      );
    } catch (e) {
      await api.sendMessage(msg.chat.id, escapeHtml((e as Error).message));
    }
    return;
  }

  if (text.startsWith('/newbot')) return startNewBot(api, from, msg.chat.id);
  if (text.startsWith('/help')) return void (await api.sendMessage(msg.chat.id, HELP));
  if (text.startsWith('/admin')) {
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(from.id) } });
    if (user?.role !== 'OWNER' && user?.role !== 'ADMIN') return void (await api.sendMessage(msg.chat.id, 'Админ-панель доступна только администраторам платформы.'));
    await api.sendMessage(msg.chat.id, '<b>Админ-панель SOLIK</b>\n\nПользователи, боты, подписки, рассылки, мониторинг чатов и каталог подарков.', {
      reply_markup: { inline_keyboard: [[{ text: 'Открыть админ-панель', web_app: { url: app('/admin') } }]] },
    });
    return;
  }
  await sendWelcome(api, msg.chat.id);
}

async function startNewBot(api: TelegramApi, from: TgUser, chatId: number) {
  const user = await ensureUser(from);
  const freeSlot = await prisma.botSubscription.findFirst({
    where: { ownerId: user.id, botId: null, status: { in: ['ACTIVE', 'CANCELLED', 'GRACE'] } },
  });
  if (freeSlot || user.role !== 'USER') {
    await redis().set(`conv:${from.id}`, 'await_token', 'EX', 900);
    await api.sendMessage(
      chatId,
      `<b>Подключение собственного бота</b>\n\n1. Откройте @BotFather → /newbot, задайте имя и username.\n2. Скопируйте токен и отправьте его сюда.\n\nТокен хранится в зашифрованном виде и больше нигде не показывается. Сообщение с токеном будет удалено.`,
    );
    return;
  }
  const plan = await ensureDefaultPlan();
  const inv = await createSubscriptionInvoice(user.id, { planId: plan.id, autoRenew: true });
  await api.sendMessage(
    chatId,
    `<b>Собственный бот — ${plan.priceStars} Stars / ${plan.periodDays} дней</b>\n\nВаш бот с вашим названием, аватаром, приветствием, шаблонами и Premium Emoji — без упоминаний SOLIK.\n\n${inv.recurring ? 'Подписка продлевается автоматически, отменить можно в любой момент в настройках.' : ''}`,
    { reply_markup: { inline_keyboard: [[{ text: `Оплатить ${inv.price} Stars`, url: inv.link }]] } },
  );
}

export async function handleMainCallback(api: TelegramApi, q: TgCallbackQuery) {
  if (!q.message) return api.answerCallbackQuery(q.id);
  if (q.data === 'm:newbot') {
    await api.answerCallbackQuery(q.id);
    return startNewBot(api, q.from, q.message.chat.id);
  }
  if (q.data === 'm:help') {
    await api.answerCallbackQuery(q.id);
    await api.sendMessage(q.message.chat.id, HELP);
    return;
  }
  return api.answerCallbackQuery(q.id);
}

export async function setupMainBotMenu(api: TelegramApi) {
  await api.setMyCommands([
    { command: 'start', description: 'Главное меню' },
    { command: 'newbot', description: 'Создать своего бота' },
    { command: 'notify', description: 'Уведомления о конкурсах в моих чатах' },
    { command: 'help', description: 'Помощь' },
  ]);
  await api.setChatMenuButton({ type: 'web_app', text: 'Открыть', web_app: { url: app('/') } });
  // platform owners also see /admin in their command list
  for (const id of platformOwnerIds) {
    await api
      .setMyCommands(
        [
          { command: 'start', description: 'Главное меню' },
          { command: 'admin', description: 'Админ-панель' },
          { command: 'newbot', description: 'Создать своего бота' },
          { command: 'notify', description: 'Уведомления о конкурсах в моих чатах' },
          { command: 'help', description: 'Помощь' },
        ],
        { type: 'chat', chat_id: Number(id) },
      )
      .catch(() => undefined);
  }
}
