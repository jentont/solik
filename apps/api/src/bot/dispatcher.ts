import type { TelegramBot } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { TelegramApi } from '../telegram/client.js';
import { sendRich } from '../telegram/messenger.js';
import { apiForBot } from '../telegram/registry.js';
import type { TgCallbackQuery, TgMessage, TgUpdate } from '../telegram/types.js';
import { escapeHtml, renderTemplate } from '../templates/render.js';
import { createBidInvoice, handleBidPayment, handleBidPreCheckout, handlePaidMessageBid } from '../modules/auction/service.js';
import { handleChatActivity } from '../modules/activity/service.js';
import { handleBusinessConnection } from '../modules/business/service.js';
import { handleAutomaticForward, handleChannelPost, handleMigration, handleMyChatMember, touchChat } from '../modules/chats/tracking.js';
import { joinContest } from '../modules/contests/lifecycle.js';
import { handleDice } from '../modules/dice/service.js';
import { confirmSmsReset, handleSmsCommand, handleSmsMessage } from '../modules/sms/service.js';
import { handleSubscriptionPayment, handleSubscriptionPreCheckout } from '../modules/subscriptions/service.js';
import { handleMainCallback, handleMainPrivate } from './mainMenu.js';

/**
 * Single entry point for every bot (platform + white-label). Group features are identical;
 * only private-chat UX differs: the platform bot shows the SOLIK menu, white-label bots
 * show the owner's own welcome/menu with no SOLIK branding.
 */
export async function dispatchUpdate(bot: TelegramBot, u: TgUpdate) {
  const api = apiForBot(bot);

  if (u.pre_checkout_query) {
    const q = u.pre_checkout_query;
    if (q.invoice_payload.startsWith('bid:')) return handleBidPreCheckout(api, q);
    if (q.invoice_payload.startsWith('sub:') && bot.isPlatform) return handleSubscriptionPreCheckout(q);
    return api.answerPreCheckoutQuery(q.id, false, 'Неизвестный платёж');
  }
  if (u.my_chat_member) return handleMyChatMember(api, bot, u.my_chat_member);
  if (u.business_connection) return handleBusinessConnection(bot, u.business_connection);
  if (u.callback_query) return handleCallback(api, bot, u.callback_query);
  if (u.channel_post) return handleChannelPost(bot, u.channel_post);

  const msg = u.message;
  if (!msg) return;

  if (msg.successful_payment) {
    const p = msg.successful_payment;
    if (p.invoice_payload.startsWith('bid:')) return handleBidPayment(bot, msg.from!, p);
    if (p.invoice_payload.startsWith('sub:') && bot.isPlatform) return handleSubscriptionPayment(msg.from!, p);
    return;
  }
  if (msg.refunded_payment) {
    await prisma.subscriptionPayment.updateMany({ where: { telegramPaymentChargeId: msg.refunded_payment.telegram_payment_charge_id }, data: { refunded: true } });
    await prisma.starsTransaction.updateMany({ where: { telegramPaymentChargeId: msg.refunded_payment.telegram_payment_charge_id }, data: { status: 'REFUNDED' } });
    return;
  }

  if (msg.chat.type === 'private') {
    await trackBotUser(bot, msg);
    // «Перебить ставку» deep link (t.me/<bot>?start=bid_<contestId>) works on every bot, the platform one included
    const bid = (msg.text ?? '').trim().match(/^\/start bid_(\w+)$/);
    if (bid && msg.from) return sendBidInvoice(api, msg.chat.id, bid[1]!, msg.from);
    return bot.isPlatform ? handleMainPrivate(api, msg) : handleWhiteLabelPrivate(api, bot, msg);
  }

  // groups / supergroups
  if (msg.migrate_to_chat_id) return handleMigration(bot, msg);
  await touchChat(bot, msg);
  if (msg.is_automatic_forward) return handleAutomaticForward(bot, msg);
  if (bot.status !== 'ACTIVE') return; // suspended/expired bots only keep tracking, no contest activity
  if (await handleSmsCommand(api, bot, msg)) return;
  if (msg.dice && (await handleDice(api, bot, msg))) return;
  if (msg.paid_star_count && (await handlePaidMessageBid(bot, msg))) return;
  await handleSmsMessage(bot, msg);
  await handleChatActivity(api, bot, msg);
}

async function trackBotUser(bot: TelegramBot, msg: TgMessage) {
  const f = msg.from;
  if (!f || f.is_bot) return;
  await prisma.botUser.upsert({
    where: { botId_tgUserId: { botId: bot.id, tgUserId: BigInt(f.id) } },
    create: { botId: bot.id, tgUserId: BigInt(f.id), username: f.username, firstName: f.first_name },
    update: { lastSeenAt: new Date(), isBlocked: false, username: f.username, firstName: f.first_name },
  });
}

/** White-label /start: owner's welcome text, media and menu. No platform branding. */
async function handleWhiteLabelPrivate(api: TelegramApi, bot: TelegramBot, msg: TgMessage) {
  const text = (msg.text ?? '').trim();
  const from = msg.from!;
  if (!text.startsWith('/start') && !text.startsWith('/help')) return;
  const media = bot.welcomeMediaId ? await prisma.mediaFile.findUnique({ where: { id: bot.welcomeMediaId } }) : null;
  const html = renderTemplate(bot.welcomeText || `Привет, {first_name}! 👋\n\nЯ — ${bot.name}. Здесь проходят конкурсы и розыгрыши.`, {
    first_name: from.first_name,
    username: from.username ? `@${from.username}` : from.first_name,
    user_id: String(from.id),
  });
  const buttons = ((bot.menuButtons as { text: string; url: string }[]) ?? []).filter((b) => b.text && /^https?:\/\//.test(b.url)).map((b) => [b]);
  await sendRich(api, bot.id, msg.chat.id, { html, media, buttons });
}

async function sendBidInvoice(api: TelegramApi, chatId: number, contestId: string, from: NonNullable<TgMessage['from']>, amount?: number) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId }, include: { prizes: true } });
  if (!contest || contest.type !== 'STARS_AUCTION') return api.sendMessage(chatId, 'Конкурс не найден');
  const res = await createBidInvoice(api, contest, from, amount);
  if (!res.ok) return api.sendMessage(chatId, `⚠️ ${res.reason}`);
  const leader = contest.leaderName ? `Сейчас лидирует ${escapeHtml(contest.leaderName)} со ставкой ${contest.currentBid} ⭐.\n` : '';
  return api.sendMessage(chatId, `⭐ <b>${escapeHtml(contest.title)}</b>\n${leader}Ваша ставка: <b>${res.amount} Stars</b>. Она засчитается сразу после оплаты.`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: `Оплатить ${res.amount} ⭐`, url: res.link }],
        [5, 10].map((plus) => ({ text: `${res.amount + plus} ⭐`, callback_data: `bidamt:${contest.id}:${res.amount + plus}` })),
      ],
    },
  });
}

async function handleCallback(api: TelegramApi, bot: TelegramBot, q: TgCallbackQuery) {
  const data = q.data ?? '';
  if (data.startsWith('bidamt:') && q.message) {
    const [, contestId, amount] = data.split(':');
    await api.answerCallbackQuery(q.id);
    await sendBidInvoice(api, q.message.chat.id, contestId!, q.from, Number(amount));
    return;
  }
  if (data.startsWith('join:')) {
    const r = await joinContest(data.slice(5), q.from);
    return api.answerCallbackQuery(q.id, r.ok ? (r.already ? `Вы уже участвуете (#${r.position})` : `✅ Вы участвуете! Ваш номер #${r.position}`) : r.message, !r.ok);
  }
  if (data.startsWith('smsreset:') && q.message) {
    const text = await confirmSmsReset(api, data.slice(9), q.message, q.from.id);
    return api.answerCallbackQuery(q.id, text);
  }
  if (data === 'noop') {
    if (q.message) await api.deleteMessage(q.message.chat.id, q.message.message_id).catch(() => undefined);
    return api.answerCallbackQuery(q.id);
  }
  if (bot.isPlatform) return handleMainCallback(api, q);
  return api.answerCallbackQuery(q.id);
}

export type { TelegramApi };
