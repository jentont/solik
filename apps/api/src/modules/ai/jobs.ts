import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { sanitizeTelegramHtml } from '../../templates/render.js';
import { mediaUrl, storeMedia } from '../media/service.js';
import { getAIProvider, type ContestPostInput } from './provider.js';
import { buildImagePrompt, composeContestImage, type ImageTemplate } from './image.js';

export async function runTextJob(jobId: string) {
  const job = await prisma.aIJob.update({ where: { id: jobId }, data: { status: 'RUNNING' } });
  try {
    const provider = await getAIProvider();
    const out = await provider.generatePost(job.input as unknown as ContestPostInput);
    const safe = { ...out, post: sanitizeTelegramHtml(out.post), text: sanitizeTelegramHtml(out.text) };
    await prisma.aIJob.update({ where: { id: jobId }, data: { status: 'DONE', output: safe as unknown as Prisma.InputJsonValue, provider: provider.id, model: provider.textModel } });
  } catch (e) {
    await prisma.aIJob.update({ where: { id: jobId }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 1000) } });
  }
}

export interface ImageJobInput {
  template: ImageTemplate;
  title: string;
  prize: string;
  date?: string;
  theme?: string;
  useAi: boolean;
  logoMediaId?: string | null;
  usePlatformLogo?: boolean;
  giftId?: string | null; // TelegramGift.id of the prize — its real artwork goes on the card
}

// Web app public folder holds the gift artwork (/gifts/*.webp): in the image it is next to the API,
// in development it is the sibling workspace.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIRS = ['/usr/src/app/web/apps/web/public', path.resolve(HERE, '../../../../web/public')];

/** "Vice Cream #421234" → Fragment slug of a collectible gift. */
export function uniqueGiftSlug(name: string): string | null {
  const m = name.trim().match(/^(.+?)\s*(?:#|-)\s*(\d+)$/);
  if (!m) return null;
  const base = m[1]!.toLowerCase().replace(/[^a-z0-9]/g, '');
  return base ? `${base}-${m[2]}` : null;
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    return r.ok && (r.headers.get('content-type') ?? '').startsWith('image/') ? Buffer.from(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** Real artwork of the prize: catalog image, collectible from Fragment, or a catalog gift matched by name. */
export async function prizeArtwork(giftId: string | null | undefined, prize: string): Promise<Buffer | null> {
  const gift = giftId
    ? await prisma.telegramGift.findUnique({ where: { id: giftId } })
    : await prisma.telegramGift.findFirst({ where: { name: { equals: prize.trim(), mode: 'insensitive' } } });
  const slug = uniqueGiftSlug(gift?.name ?? prize);
  if (gift?.imageUrl) {
    if (/^https?:\/\//.test(gift.imageUrl)) {
      const img = await fetchImage(gift.imageUrl);
      if (img) return img;
    } else {
      for (const dir of PUBLIC_DIRS) {
        const file = await readFile(path.join(dir, gift.imageUrl)).catch(() => null);
        if (file) return file;
      }
    }
  }
  return slug ? fetchImage(`https://nft.fragment.com/gift/${slug}.webp`) : null;
}

export async function runImageJob(jobId: string) {
  const job = await prisma.aIJob.update({ where: { id: jobId }, data: { status: 'RUNNING' } });
  const input = job.input as unknown as ImageJobInput;
  try {
    let background: Buffer | null = null;
    let model: string | undefined;
    let note: string | undefined;
    if (input.useAi) {
      try {
        const provider = await getAIProvider();
        background = await provider.generateImage(buildImagePrompt(input.template, input.prize, input.theme));
        model = provider.imageModel;
      } catch (e) {
        // free image quotas run out often: still deliver a branded template image
        note = `AI-иллюстрация недоступна, сделана фирменная карточка с подарком (${(e as Error).message.slice(0, 200)})`;
      }
    }
    let logo: Buffer | null = null;
    if (input.logoMediaId) {
      const m = await prisma.mediaFile.findFirst({ where: { id: input.logoMediaId, ownerId: job.ownerId } });
      if (m) logo = await readFile(path.resolve(env.UPLOAD_DIR, m.path));
    }
    const giftImage = background ? null : await prizeArtwork(input.giftId, input.prize);
    const img = await composeContestImage({ background, giftImage, template: input.template, title: input.title, prize: input.prize, date: input.date, logo, usePlatformLogo: input.usePlatformLogo });
    const media = await storeMedia(job.ownerId, img, { source: 'ai' });
    await prisma.aIJob.update({
      where: { id: jobId },
      data: { status: 'DONE', output: { mediaId: media.id, url: mediaUrl(media.id), note }, provider: background ? 'ai' : 'template', model },
    });
  } catch (e) {
    await prisma.aIJob.update({ where: { id: jobId }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 1000) } });
  }
}
