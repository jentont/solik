import { readFile } from 'node:fs/promises';
import path from 'node:path';
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
        note = `AI-фон недоступен, использован фирменный шаблон (${(e as Error).message.slice(0, 200)})`;
      }
    }
    let logo: Buffer | null = null;
    if (input.logoMediaId) {
      const m = await prisma.mediaFile.findFirst({ where: { id: input.logoMediaId, ownerId: job.ownerId } });
      if (m) logo = await readFile(path.resolve(env.UPLOAD_DIR, m.path));
    }
    const img = await composeContestImage({ background, template: input.template, title: input.title, prize: input.prize, date: input.date, logo, usePlatformLogo: input.usePlatformLogo });
    const media = await storeMedia(job.ownerId, img, { source: 'ai' });
    await prisma.aIJob.update({
      where: { id: jobId },
      data: { status: 'DONE', output: { mediaId: media.id, url: mediaUrl(media.id), note }, provider: background ? 'ai' : 'template', model },
    });
  } catch (e) {
    await prisma.aIJob.update({ where: { id: jobId }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 1000) } });
  }
}
