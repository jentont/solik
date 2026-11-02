import { mkdir, writeFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import type { MediaKind } from '@prisma/client';
import { env } from '../../config/env.js';
import { badRequest } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { randomToken } from '../../lib/crypto.js';

/** Detects type by magic bytes — the client-provided mime is not trusted. */
export function sniff(buf: Buffer): { kind: MediaKind; mime: string; ext: string } | null {
  if (buf.subarray(0, 3).toString('ascii') === 'GIF') return { kind: 'ANIMATION', mime: 'image/gif', ext: 'gif' };
  if (buf[0] === 0xff && buf[1] === 0xd8) return { kind: 'PHOTO', mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'PHOTO', mime: 'image/png', ext: 'png' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { kind: 'PHOTO', mime: 'image/webp', ext: 'webp' };
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') return { kind: 'VIDEO', mime: 'video/mp4', ext: 'mp4' };
  return null;
}

export async function storeMedia(ownerId: string, buf: Buffer, opts: { asAnimation?: boolean; source?: string } = {}) {
  const t = sniff(buf);
  if (!t) throw badRequest('Поддерживаются JPG, PNG, WEBP, GIF и MP4');
  if (buf.length > env.MAX_UPLOAD_MB * 1024 * 1024) throw badRequest(`Файл больше ${env.MAX_UPLOAD_MB} МБ`);
  let data = buf;
  let { kind, mime, ext } = t;
  let width: number | undefined;
  let height: number | undefined;
  if (kind === 'PHOTO') {
    // re-encode: strips metadata and any payload hidden in the file
    const img = sharp(buf, { failOn: 'error' }).rotate();
    const meta = await img.metadata();
    data = await img.resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    mime = 'image/jpeg';
    ext = 'jpg';
    width = meta.width;
    height = meta.height;
  } else if (kind === 'ANIMATION') {
    const meta = await sharp(buf, { animated: true }).metadata().catch(() => null);
    width = meta?.width;
    height = meta?.pageHeight ?? meta?.height;
  }
  if (kind === 'VIDEO' && opts.asAnimation) kind = 'ANIMATION'; // MP4 without sound → Telegram animation
  const rel = path.join(ownerId, `${Date.now()}-${randomToken(6)}.${ext}`);
  const abs = path.resolve(env.UPLOAD_DIR, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
  return prisma.mediaFile.create({ data: { ownerId, kind, path: rel, mime, size: data.length, width, height, source: opts.source ?? 'upload' } });
}

// Media URLs are signed so that <img> tags work without exposing auth tokens.
export function signMedia(id: string) {
  return createHmac('sha256', env.JWT_SECRET).update(`media:${id}`).digest('base64url').slice(0, 22);
}
export function mediaUrl(id: string) {
  return `/api/media/${id}/file?sig=${signMedia(id)}`;
}
