import { env } from '../config/env.js';
import type { TelegramApi } from './client.js';

/**
 * Premium emoji from the configured pack (t.me/addemoji/<MENU_EMOJI_PACK>), looked up by the plain emoji
 * character each sticker stands for. Cached for an hour.
 */
let cache: { at: number; byChar: Map<string, string>; all: string[] } | null = null;

export async function packEmoji(api: TelegramApi) {
  if (cache && Date.now() - cache.at < 3600_000) return cache;
  const byChar = new Map<string, string>();
  const all: string[] = [];
  try {
    const set = await api.getStickerSet(env.MENU_EMOJI_PACK);
    for (const st of set.stickers) {
      if (!st.custom_emoji_id) continue;
      all.push(st.custom_emoji_id);
      for (const ch of [...(st.emoji ?? '')]) if (!byChar.has(ch)) byChar.set(ch, st.custom_emoji_id);
    }
  } catch {
    // pack missing or unreachable: messages go without premium emoji
  }
  cache = { at: Date.now(), byChar, all };
  return cache;
}

// what to try when the pack has no sticker for the exact character
const ALTERNATIVES: Record<string, string[]> = {
  '🎁': ['🎁', '🎄', '🎅', '⭐'],
  '🔥': ['🔥', '⚡', '✨', '⭐'],
  '🏆': ['🏆', '🥇', '👑', '⭐', '🎉'],
  '🎉': ['🎉', '🥳', '✨', '🎄'],
  '⏳': ['⏳', '⌛', '⏰', '❄'],
  '👑': ['👑', '🏆', '⭐'],
  '⭐': ['⭐', '🌟', '✨'],
  '❄': ['❄', '⛄', '☃'],
  '✅': ['✅', '✔', '☑', '⭐'],
};

/** `[[e:🎁]]` in a default template = a premium emoji from the pack for that character. */
export const PACK_TOKEN = /\[\[e:([^\]]{1,8})\]\]/g;

/**
 * Turns `[[e:…]]` tokens into `<tg-emoji>` from the pack. A token with no match is removed:
 * plain Unicode emoji are never sent instead.
 */
export async function resolvePackEmoji(api: TelegramApi, html: string): Promise<string> {
  if (!html.includes('[[e:')) return html;
  const e = await packEmoji(api);
  return html.replace(PACK_TOKEN, (_w, ch: string) => {
    for (const c of ALTERNATIVES[ch] ?? [ch]) {
      const id = e.byChar.get(c) ?? e.byChar.get(c.replace('️', ''));
      if (id) return `<tg-emoji emoji-id="${id}">${ch}</tg-emoji>`;
    }
    return '';
  }).replace(/^[ \t]+/gm, '');
}

/** Removes premium emoji completely (used when Telegram refuses them for this bot). */
export function dropCustomEmoji(html: string): string {
  return html.replace(/<tg-emoji[^>]*>.*?<\/tg-emoji>\s?/g, '');
}
