import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TelegramBot } from '@prisma/client';
import { env } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import { encrypt, randomToken } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { TelegramApi, TelegramError } from '../../telegram/client.js';
import { apiForBot, invalidateBot, webhookUrl } from '../../telegram/registry.js';
import { findFreeSlot } from '../subscriptions/service.js';

export const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,50}$/;

/** Never return the token (even encrypted) to clients. */
export function publicBot(b: TelegramBot & Record<string, any>) {
  const { tokenEncrypted: _t, webhookSecret: _w, ...rest } = b;
  return rest;
}

export const DEFAULT_COMMANDS = [
  { command: 'start', description: 'Начать' },
  { command: 'help', description: 'Помощь' },
];

/** Connects a white-label bot by BotFather token. Validates, stores encrypted, sets webhook. */
export async function connectBot(userId: string, token: string) {
  token = token.trim();
  if (!TOKEN_RE.test(token)) throw badRequest('Неверный формат токена. Скопируйте его из @BotFather целиком.');
  const api = new TelegramApi(token);
  let me;
  try {
    me = await api.getMe();
  } catch (e) {
    throw badRequest(e instanceof TelegramError && e.code === 401 ? 'Токен недействителен' : 'Не удалось проверить токен');
  }
  if (token.split(':')[0] === env.MAIN_BOT_TOKEN.split(':')[0]) throw badRequest('Нельзя подключить бота платформы');

  const existing = await prisma.telegramBot.findUnique({ where: { telegramId: BigInt(me.id) } });
  if (existing && existing.ownerId !== userId) throw conflict('Этот бот уже подключен другим пользователем');

  const slot = existing ? null : await findFreeSlot(userId);
  const webhookSecret = randomToken(24);
  const bot = existing
    ? await prisma.telegramBot.update({
        where: { id: existing.id },
        data: { tokenEncrypted: encrypt(token), webhookSecret, username: me.username!, name: me.first_name, canReadAll: !!me.can_read_all_group_messages, lastError: null, status: existing.status === 'INVALID_TOKEN' ? 'ACTIVE' : existing.status },
      })
    : await prisma.telegramBot.create({
        data: {
          ownerId: userId,
          telegramId: BigInt(me.id),
          username: me.username!,
          name: me.first_name,
          tokenEncrypted: encrypt(token),
          webhookSecret,
          canReadAll: !!me.can_read_all_group_messages,
          commands: DEFAULT_COMMANDS,
        },
      });
  invalidateBot(bot.id);
  if (slot) await prisma.botSubscription.update({ where: { id: slot.id }, data: { botId: bot.id } });

  try {
    await api.setWebhook(webhookUrl(bot.id), webhookSecret);
    await api.setMyCommands(DEFAULT_COMMANDS).catch(() => undefined);
  } catch (e) {
    await prisma.telegramBot.update({ where: { id: bot.id }, data: { lastError: String((e as Error).message) } });
  }
  await audit(existing ? 'bot.reconnect' : 'bot.connect', { actorId: userId, entity: 'TelegramBot', entityId: bot.id, meta: { username: me.username } });
  return checkBotStatus(bot.id);
}

export async function checkBotStatus(botId: string) {
  const bot = await prisma.telegramBot.findUniqueOrThrow({ where: { id: botId } });
  const api = apiForBot(bot);
  let lastError: string | null = null;
  let webhook: { url: string; pending_update_count: number; last_error_message?: string } | null = null;
  try {
    const me = await api.getMe();
    webhook = await api.getWebhookInfo();
    if (!bot.isPlatform && webhook.url !== webhookUrl(bot.id)) {
      await api.setWebhook(webhookUrl(bot.id), bot.webhookSecret);
      webhook = await api.getWebhookInfo();
    }
    lastError = webhook.last_error_message ?? null;
    await prisma.telegramBot.update({
      where: { id: bot.id },
      data: { username: me.username!, name: me.first_name, canReadAll: !!me.can_read_all_group_messages, lastError, ...(bot.status === 'INVALID_TOKEN' ? { status: 'ACTIVE' } : {}) },
    });
  } catch (e) {
    lastError = (e as Error).message;
    const invalid = e instanceof TelegramError && e.code === 401;
    await prisma.telegramBot.update({ where: { id: bot.id }, data: { lastError, ...(invalid ? { status: 'INVALID_TOKEN' } : {}) } });
  }
  const fresh = await prisma.telegramBot.findUniqueOrThrow({ where: { id: botId } });
  return { bot: publicBot(fresh), webhook: webhook ? { ok: !webhook.last_error_message, pending: webhook.pending_update_count, lastError: webhook.last_error_message ?? null } : null };
}

export interface ProfileInput {
  name?: string;
  description?: string;
  shortDescription?: string;
  welcomeText?: string;
  welcomeMediaId?: string | null;
  avatarMediaId?: string | null;
  commands?: { command: string; description: string }[];
  menuButtons?: { text: string; url: string }[];
}

/** Applies white-label profile to Telegram. Username can only be changed in @BotFather. */
export async function updateBotProfile(botId: string, userId: string, input: ProfileInput) {
  const bot = await prisma.telegramBot.findUniqueOrThrow({ where: { id: botId } });
  if (bot.isPlatform) throw forbidden('Профиль бота платформы меняется только администратором');
  const api = apiForBot(bot);
  const warnings: string[] = [];
  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      warnings.push(`${label}: ${e instanceof TelegramError ? e.description : (e as Error).message}`);
    }
  };
  if (input.name !== undefined) await run('Название', () => api.setMyName(input.name!));
  if (input.description !== undefined) await run('Описание', () => api.setMyDescription(input.description!));
  if (input.shortDescription !== undefined) await run('Краткое описание', () => api.setMyShortDescription(input.shortDescription!));
  if (input.commands) await run('Команды', () => api.setMyCommands(input.commands!));
  if (input.avatarMediaId) {
    const media = await prisma.mediaFile.findFirst({ where: { id: input.avatarMediaId, ownerId: userId, kind: 'PHOTO' } });
    if (!media) throw notFound('Изображение не найдено');
    await run('Аватар', async () => {
      try {
        const data = await readFile(path.resolve(env.UPLOAD_DIR, media.path));
        await api.upload('setMyProfilePhoto', 'avatar', { data, filename: path.basename(media.path), mime: media.mime }, { photo: { type: 'static', photo: 'attach://avatar' } });
      } catch (e) {
        if (e instanceof TelegramError && e.isMethodUnsupported) throw new Error('установите аватар через @BotFather → /setuserpic');
        throw e;
      }
    });
  }
  const updated = await prisma.telegramBot.update({
    where: { id: botId },
    data: {
      name: input.name ?? undefined,
      description: input.description,
      shortDescription: input.shortDescription,
      welcomeText: input.welcomeText,
      welcomeMediaId: input.welcomeMediaId,
      avatarMediaId: input.avatarMediaId,
      commands: input.commands ?? undefined,
      menuButtons: input.menuButtons ?? undefined,
    },
  });
  await audit('bot.profile_update', { actorId: userId, entity: 'TelegramBot', entityId: botId, meta: { warnings } });
  return { bot: publicBot(updated), warnings };
}

export async function setBotEnabled(botId: string, userId: string, enabled: boolean) {
  const bot = await prisma.telegramBot.findUniqueOrThrow({ where: { id: botId } });
  if (bot.status === 'SUSPENDED') throw forbidden('Бот приостановлен администрацией');
  const api = apiForBot(bot);
  if (enabled) await api.setWebhook(webhookUrl(bot.id), bot.webhookSecret);
  else await api.deleteWebhook().catch(() => undefined);
  const updated = await prisma.telegramBot.update({ where: { id: botId }, data: { status: enabled ? 'ACTIVE' : 'DISABLED' } });
  await audit(enabled ? 'bot.enable' : 'bot.disable', { actorId: userId, entity: 'TelegramBot', entityId: botId });
  return publicBot(updated);
}

export async function deleteBot(botId: string, userId: string) {
  const bot = await prisma.telegramBot.findUniqueOrThrow({ where: { id: botId } });
  if (bot.isPlatform) throw forbidden();
  await apiForBot(bot).deleteWebhook().catch(() => undefined);
  await prisma.telegramBot.delete({ where: { id: botId } }); // subscription slot is freed (botId → null)
  invalidateBot(botId);
  await audit('bot.delete', { actorId: userId, entity: 'TelegramBot', entityId: botId, meta: { username: bot.username } });
}

/** Registers the platform bot row (ownerless) so chats/contests share one data model. */
export async function registerPlatformBot() {
  const { mainApi, setPlatformBotId } = await import('../../telegram/registry.js');
  const me = await mainApi.getMe();
  const bot = await prisma.telegramBot.upsert({
    where: { telegramId: BigInt(me.id) },
    create: {
      telegramId: BigInt(me.id),
      isPlatform: true,
      username: me.username!,
      name: me.first_name,
      tokenEncrypted: encrypt(env.MAIN_BOT_TOKEN),
      webhookSecret: env.MAIN_BOT_WEBHOOK_SECRET || randomToken(24),
      canReadAll: !!me.can_read_all_group_messages,
    },
    update: { username: me.username!, name: me.first_name, isPlatform: true, ...(env.MAIN_BOT_WEBHOOK_SECRET ? { webhookSecret: env.MAIN_BOT_WEBHOOK_SECRET } : {}) },
  });
  setPlatformBotId(bot.id);
  return bot;
}
