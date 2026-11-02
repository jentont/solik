import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { MediaFile, TemplateKey } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { DEFAULT_TEMPLATES } from '../templates/defaults.js';
import { renderTemplate, type TemplateVars } from '../templates/render.js';
import { dropCustomEmoji, PACK_TOKEN, resolvePackEmoji } from './emojiPack.js';
import { TelegramApi, TelegramError, type SendOptions } from './client.js';
import type { TgInlineButton, TgMessage } from './types.js';

export interface TemplateButton {
  text: string;
  url?: string;
  callback?: string;
}

export function buildKeyboard(buttons: TemplateButton[][] | TemplateButton[] | undefined | null) {
  if (!buttons || !buttons.length) return undefined;
  const rows = (Array.isArray(buttons[0]) ? buttons : (buttons as TemplateButton[]).map((b) => [b])) as TemplateButton[][];
  const inline_keyboard: TgInlineButton[][] = rows
    .map((row) =>
      row
        .filter((b) => b.text && (b.url || b.callback))
        .map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.callback!.slice(0, 64) })),
    )
    .filter((r) => r.length);
  return inline_keyboard.length ? { inline_keyboard } : undefined;
}

/** Resolves the effective template: bot-specific → owner-wide → built-in default. */
export async function resolveTemplate(ownerId: string | null, botId: string, key: TemplateKey) {
  if (ownerId) {
    const tpl = await prisma.messageTemplate.findFirst({
      where: { ownerId, key, isActive: true, OR: [{ botId }, { botId: null }] },
      orderBy: [{ botId: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
      include: { media: true },
    });
    if (tpl) return { text: tpl.text, media: tpl.media, buttons: tpl.buttons as unknown as TemplateButton[] };
  }
  return { text: DEFAULT_TEMPLATES[key], media: null as MediaFile | null, buttons: [] as TemplateButton[] };
}

/** Gets (or uploads and caches) the bot-specific file_id for a stored media file. */
async function sendWithMedia(
  api: TelegramApi,
  botId: string,
  chatId: number | bigint,
  media: MediaFile,
  caption: string,
  opts: SendOptions,
): Promise<TgMessage> {
  const method = media.kind === 'ANIMATION' ? 'sendAnimation' : media.kind === 'VIDEO' ? 'sendVideo' : 'sendPhoto';
  const field = media.kind === 'ANIMATION' ? 'animation' : media.kind === 'VIDEO' ? 'video' : 'photo';
  const cached = await prisma.mediaTelegramFile.findUnique({ where: { mediaId_botId: { mediaId: media.id, botId } } });
  if (cached) {
    return api.call<TgMessage>(method, { chat_id: chatId, [field]: cached.fileId, caption, parse_mode: 'HTML', ...opts });
  }
  const data = await readFile(path.resolve(env.UPLOAD_DIR, media.path));
  const msg = await api.upload<TgMessage & Record<string, any>>(method, field, { data, filename: path.basename(media.path), mime: media.mime }, {
    chat_id: chatId.toString(),
    caption,
    parse_mode: 'HTML',
    ...opts,
  });
  const fileId: string | undefined =
    msg.animation?.file_id ?? msg.video?.file_id ?? (msg.photo ? msg.photo[msg.photo.length - 1]?.file_id : undefined);
  if (fileId) {
    await prisma.mediaTelegramFile.upsert({
      where: { mediaId_botId: { mediaId: media.id, botId } },
      create: { mediaId: media.id, botId, fileId },
      update: { fileId },
    });
  }
  return msg;
}

export interface RichMessage {
  html: string; // already rendered & sanitized
  media?: MediaFile | null;
  buttons?: TemplateButton[][] | TemplateButton[];
}

/**
 * Sends a rendered message. If Telegram rejects premium emoji (bots without Fragment
 * usernames can't use custom emoji in some contexts), retries without them.
 */
export async function sendRich(api: TelegramApi, botId: string, chatId: number | bigint, msg: RichMessage, opts: SendOptions = {}) {
  const reply_markup = buildKeyboard(msg.buttons) ?? opts.reply_markup;
  const attempt = (html: string) =>
    msg.media
      ? sendWithMedia(api, botId, chatId, msg.media, html.slice(0, 1024), { ...opts, reply_markup })
      : api.sendMessage(chatId, html.slice(0, 4096), { link_preview_options: { is_disabled: true }, ...opts, reply_markup });
  const html = await resolvePackEmoji(api, msg.html).catch(() => msg.html.replace(PACK_TOKEN, ''));
  try {
    return await attempt(html);
  } catch (e) {
    // no plain emoji as a fallback: the message goes out clean
    if (e instanceof TelegramError && e.code === 400 && html.includes('<tg-emoji') && e.isCustomEmojiRejected) {
      return attempt(dropCustomEmoji(html));
    }
    throw e;
  }
}

export async function sendTemplate(
  api: TelegramApi,
  ctx: { ownerId: string | null; botId: string },
  chatId: number | bigint,
  key: TemplateKey,
  vars: TemplateVars,
  opts: SendOptions = {},
) {
  const tpl = await resolveTemplate(ctx.ownerId, ctx.botId, key);
  return sendRich(api, ctx.botId, chatId, { html: renderTemplate(tpl.text, vars), media: tpl.media, buttons: tpl.buttons }, opts);
}
