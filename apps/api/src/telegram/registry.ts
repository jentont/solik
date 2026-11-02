import type { TelegramBot } from '@prisma/client';
import { env } from '../config/env.js';
import { decrypt } from '../lib/crypto.js';
import { prisma } from '../lib/prisma.js';
import { TelegramApi } from './client.js';

// Decrypted tokens are kept only in process memory.
const cache = new Map<string, { api: TelegramApi; at: number }>();
const TTL = 10 * 60_000;

export const mainApi = new TelegramApi(env.MAIN_BOT_TOKEN);

let platformBotId: string | null = null;
export function setPlatformBotId(id: string) {
  platformBotId = id;
}
export function getPlatformBotId(): string {
  if (!platformBotId) throw new Error('platform bot is not registered yet');
  return platformBotId;
}

export function apiForBot(bot: Pick<TelegramBot, 'id' | 'tokenEncrypted' | 'isPlatform'>): TelegramApi {
  if (bot.isPlatform) return mainApi;
  const hit = cache.get(bot.id);
  if (hit && Date.now() - hit.at < TTL) return hit.api;
  const api = new TelegramApi(decrypt(bot.tokenEncrypted));
  cache.set(bot.id, { api, at: Date.now() });
  return api;
}

export async function apiForBotId(botId: string): Promise<TelegramApi> {
  const hit = cache.get(botId);
  if (hit && Date.now() - hit.at < TTL) return hit.api;
  const bot = await prisma.telegramBot.findUniqueOrThrow({ where: { id: botId } });
  return apiForBot(bot);
}

export function invalidateBot(botId: string) {
  cache.delete(botId);
}

export function webhookUrl(botId: string) {
  return `${env.PUBLIC_API_URL.replace(/\/$/, '')}/webhook/${botId}`;
}
