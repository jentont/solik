import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '../../config/env.js';
import { escapeHtml } from '../../templates/render.js';

export const IMAGE_TEMPLATES = {
  // cartoon illustration with bold outlines — like the reference winner posts
  cartoon: {
    label: 'Мультяшная иллюстрация',
    prompt: 'vibrant cartoon illustration, bold clean black outlines, cel shading, expressive happy character, sparkles, rich warm colors, detailed background',
    accent: '#FFD54A',
    overlay: true,
  },
  premium: {
    label: 'Премиум тёмный',
    prompt: 'luxury dark studio scene, glossy 3D gift box, gold particles, cinematic rim light, deep navy and violet tones',
    accent: '#8B7CFF',
    overlay: true,
  },
  minimal: {
    label: 'Минимализм',
    prompt: 'minimal clean 3D render, soft pastel gradient background, single centered gift object, soft shadows',
    accent: '#4ADE80',
    overlay: true,
  },
} as const;

export type ImageTemplate = keyof typeof IMAGE_TEMPLATES;

export function buildImagePrompt(t: ImageTemplate, prize: string, theme?: string) {
  return `${IMAGE_TEMPLATES[t].prompt}. Subject: a giveaway of "${prize}"${theme ? `, theme: ${theme}` : ''}. Wide 16:9 composition, keep the lower third calm for text. No text, no letters, no logos, no watermarks.`;
}

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

/**
 * Composes the final 1280×720 post image: background (AI or gradient) + SVG text layer
 * (title / prize / date) + the provided logo. The logo is never generated.
 */
export async function composeContestImage(opts: {
  background?: Buffer | null;
  template: ImageTemplate;
  title: string;
  prize: string;
  date?: string;
  logo?: Buffer | null; // white-label owner logo; null → no logo
  usePlatformLogo?: boolean;
}): Promise<Buffer> {
  const W = 1280;
  const H = 720;
  const tpl = IMAGE_TEMPLATES[opts.template];
  const base = opts.background
    ? sharp(opts.background).resize(W, H, { fit: 'cover' })
    : sharp(Buffer.from(
        `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B0B12"/><stop offset="1" stop-color="#1D1640"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
      ));

  const titleLines = wrap(opts.title, 28);
  const layer = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.82"/></linearGradient></defs>
  ${tpl.overlay ? `<rect width="100%" height="100%" fill="url(#fade)"/>` : ''}
  <g font-family="Inter, 'Segoe UI', Arial, sans-serif" fill="#fff">
    ${titleLines.map((l, i) => `<text x="56" y="${H - 190 - (titleLines.length - 1 - i) * 58}" font-size="52" font-weight="800">${escapeHtml(l)}</text>`).join('')}
    <rect x="56" y="${H - 150}" rx="14" ry="14" width="${Math.min(1100, 40 + opts.prize.length * 22)}" height="56" fill="${tpl.accent}" fill-opacity="0.95"/>
    <text x="76" y="${H - 112}" font-size="30" font-weight="700" fill="#111">🎁 ${escapeHtml(opts.prize.slice(0, 48))}</text>
    ${opts.date ? `<text x="56" y="${H - 52}" font-size="26" font-weight="500" fill="#fff" fill-opacity="0.85">${escapeHtml(opts.date)}</text>` : ''}
  </g></svg>`;

  const composites: sharp.OverlayOptions[] = [{ input: Buffer.from(layer), top: 0, left: 0 }];
  let logo = opts.logo ?? null;
  if (!logo && opts.usePlatformLogo) logo = await readFile(path.resolve(env.BRAND_LOGO_PATH)).catch(() => null);
  if (logo) {
    const l = await sharp(logo).resize({ height: 72, width: 260, fit: 'inside' }).png().toBuffer();
    composites.push({ input: l, top: 40, left: 48 });
  }
  return base.composite(composites).jpeg({ quality: 90 }).toBuffer();
}
