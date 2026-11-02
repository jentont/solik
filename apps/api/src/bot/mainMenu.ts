import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import type { TelegramApi } from '../telegram/client.js';
import type { TgCallbackQuery, TgMessage, TgUser } from '../telegram/types.js';
import { escapeHtml } from '../templates/render.js';
import { ensureUser } from '../modules/chats/access.js';
import { connectBot, TOKEN_RE } from '../modules/bots/service.js';
import { createSubscriptionInvoice } from '../modules/subscriptions/service.js';
import { ensureDefaultPlan } from '../modules/subscriptions/plans.js';

const WELCOME = `<b>Добро пожаловать в SOLIK!</b>

Создавай Telegram-конкурсы, раздавай подарки, проводи розыгрыши Stars и управляй своим сообществом в одном месте.

Все инструменты для конкурсов — в одном боте.`;

const app = (path = '') => `${env.WEB_APP_URL.replace(/\/$/, '')}${path}`;

function mainKeyboard() {
  const wa = (text: string, path: string) => ({ text, web_app: { url: app(path) } });
  return {
    inline_keyboard: [
      [{ text: '🤖 Создать бота', callback_data: 'm:newbot' }, wa('📂 Мои боты', '/bots')],
      [wa('🏆 Конкурсы', '/contests'), wa('🎁 Розыгрыши', '/contests/new')],
      [wa('💝 Telegram Gifts', '/gifts'), wa('💬 SMS Counter', '/sms')],
      [wa('📊 Аналитика', '/analytics'), wa('⚙️ Настройки', '/settings')],
      [{ text: '➕ Добавить в чат', url: '' }, { text: '❓ Помощь', callback_data: 'm:help' }],
    ],
  };
}

const HELP = `<b>Как начать</b>

<b>Бесплатно:</b> добавьте этого бота администратором в свой чат или канал — он появится в панели, и можно запускать конкурсы.

<b>Свой бот (White-Label):</b> «Создать бота» → оплата подписки в Stars → токен от @BotFather. Бот будет выглядеть как ваш собственный продукт.

<b>SMS Counter в чате:</b> <code>.sms 100</code> — первые 100 участников, <code>.sms help</code> — все команды.

Вся настройка — в панели (кнопка «Открыть» внизу).`;

export async function handleMainPrivate(api: TelegramApi, msg: TgMessage) {
  const from = msg.from!;
  await ensureUser(from);
  const text = (msg.text ?? '').trim();
  const me = await api.getMe();
  const kb = mainKeyboard();
  kb.inline_keyboard[4]![0] = { text: '➕ Добавить в чат', url: `https://t.me/${me.username}?startgroup=solik&admin=post_messages+delete_messages+pin_messages+manage_chat` };

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
        `✅ Бот @${escapeHtml(String(res.bot.username))} подключен!\n\nДобавьте его администратором в свой чат или канал и настройте внешний вид в панели.`,
        { reply_markup: { inline_keyboard: [[{ text: '⚙️ Открыть панель бота', web_app: { url: app(`/bots/${res.bot.id}`) } }]] } },
      );
    } catch (e) {
      await api.sendMessage(msg.chat.id, `⚠️ ${escapeHtml((e as Error).message)}`);
    }
    return;
  }

  if (text.startsWith('/newbot')) return startNewBot(api, from, msg.chat.id);
  if (text.startsWith('/help')) return void (await api.sendMessage(msg.chat.id, HELP));
  await api.sendMessage(msg.chat.id, WELCOME, { reply_markup: kb });
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
    `<b>Собственный бот — ${plan.priceStars} ⭐ / ${plan.periodDays} дней</b>\n\nВаш бот с вашим названием, аватаром, приветствием, шаблонами и Premium Emoji — без упоминаний SOLIK.\n\n${inv.recurring ? 'Подписка продлевается автоматически, отменить можно в любой момент в настройках.' : ''}`,
    { reply_markup: { inline_keyboard: [[{ text: `⭐ Оплатить ${inv.price} Stars`, url: inv.link }]] } },
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
    { command: 'help', description: 'Помощь' },
  ]);
  await api.setChatMenuButton({ type: 'web_app', text: 'Открыть', web_app: { url: app('/') } });
}
