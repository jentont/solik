import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';
import { env } from '../../config/env.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets');

/**
 * AI illustration styles. Prompts aim at the reference «winner post» look: clean sticker-like
 * cartoon art with thick outlines, a cute expressive character, sparkles and a detailed scene.
 */
export const IMAGE_TEMPLATES = {
  cartoon: {
    label: 'Мультяшная иллюстрация',
    prompt:
      'High-quality 2D cartoon illustration in a modern sticker style: thick clean dark outlines, soft cel shading, a cute chibi character with big shiny eyes and pink blush cheeks in a joyful excited pose, white glints and sparkles around it, a richly detailed scene with a pile of the prize, warm textured paper background, cinematic wide composition, crisp details',
  },
  premium: {
    label: 'Премиум 3D',
    prompt:
      'Premium glossy 3D render, Pixar-like quality: the prize as a luxurious centerpiece on a pedestal, soft studio lighting, gold particles and bokeh, deep blue background with subtle gradient, sparkles, ultra detailed, sharp focus',
  },
  minimal: {
    label: 'Минимализм',
    prompt:
      'Minimal clean 3D illustration, soft pastel gradient background, the prize centered with soft shadow, a few floating sparkles, lots of empty space, calm and elegant',
  },
} as const;

export type ImageTemplate = keyof typeof IMAGE_TEMPLATES;

export function buildImagePrompt(t: ImageTemplate, prize: string, theme?: string) {
  return `${IMAGE_TEMPLATES[t].prompt}. Prize / subject: ${prize}${theme ? `. Scene idea: ${theme}` : ''}. Landscape 16:9. Absolutely no text, letters, numbers, logos or watermarks anywhere in the image.`;
}

// ---------------------------------------------------------------- text as vector paths
// Text is drawn from the bundled font files as SVG paths, so the result never depends on system fonts.
type FontFile = 'Unbounded-ExtraBold' | 'Onest-Bold' | 'Onest-Medium';
const fonts = new Map<FontFile, opentype.Font>();
function font(file: FontFile) {
  let f = fonts.get(file);
  if (!f) {
    f = opentype.loadSync(path.join(ASSETS, 'fonts', `${file}.ttf`));
    fonts.set(file, f);
  }
  return f;
}

const width = (f: opentype.Font, text: string, size: number, spacing = 0) => f.getAdvanceWidth(text, size, { letterSpacing: spacing });

function textPath(f: opentype.Font, text: string, x: number, y: number, size: number, fill: string, spacing = 0, extra = '') {
  const d = f.getPath(text, x, y, size, { kerning: true, letterSpacing: spacing }).toPathData(2);
  return `<path d="${d}" fill="${fill}" ${extra}/>`;
}

/** Greedy word wrap by measured width. */
export function wrapToWidth(f: opentype.Font, text: string, size: number, maxW: number, spacing = 0): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && width(f, next, size, spacing) > maxW) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Largest title size that fits in maxLines lines of maxW. */
export function fitTitle(text: string, maxW: number, maxLines = 3, max = 76, min = 40) {
  const f = font('Unbounded-ExtraBold');
  for (let size = max; size >= min; size -= 2) {
    const lines = wrapToWidth(f, text, size, maxW, 0);
    if (lines.length <= maxLines && lines.every((l) => width(f, l, size, 0) <= maxW)) return { size, lines };
  }
  return { size: min, lines: wrapToWidth(f, text, min, maxW, 0).slice(0, maxLines) };
}

// ---------------------------------------------------------------- decorative pieces
function sparkle(cx: number, cy: number, r: number, opacity = 1) {
  const t = r * 0.16;
  return `<path d="M${cx} ${cy - r} L${cx + t} ${cy - t} L${cx + r} ${cy} L${cx + t} ${cy + t} L${cx} ${cy + r} L${cx - t} ${cy + t} L${cx - r} ${cy} L${cx - t} ${cy - t} Z" fill="#fff" opacity="${opacity}" filter="url(#glow)"/>`;
}

function star(cx: number, cy: number, r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.46;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="url(#gold)" stroke="#F5A623" stroke-width="${(r * 0.08).toFixed(1)}" stroke-linejoin="round" filter="url(#shadow)"/>`;
}

async function patternTile(): Promise<sharp.OverlayOptions[]> {
  const pattern = await readFile(path.join(ASSETS, 'pattern.png')).catch(() => null);
  if (!pattern) return [];
  const tile = 300;
  // sticker-outline wallpaper (as in the Mini App): white strokes at ~7% opacity
  const { data, info } = await sharp(pattern).resize(tile, tile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = Math.round(data[i * 4 + 3]! * 0.07);
  }
  const white = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return [{ input: white, tile: true, top: 0, left: 0 }];
}

const DEFS = `<defs>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD86B"/><stop offset="1" stop-color="#F5A623"/></linearGradient>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="#021a4a" flood-opacity="0.35"/></filter>
  <filter id="giftShadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="6" dy="22" stdDeviation="18" flood-color="#021a4a" flood-opacity="0.5"/></filter>
  <filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>`;

/**
 * Composes the 1280×720 contest image.
 *  - AI background: the illustration is used as is — clean, no text over it (text goes into the post caption),
 *    only the owner's logo if requested.
 *  - Otherwise: Solik blue card with the real prize gift on the right and title / prize / date on the left.
 * The logo is never generated: only the owner's file (or BRAND_LOGO_PATH) is used.
 */
export async function composeContestImage(opts: {
  background?: Buffer | null;
  giftImage?: Buffer | null;
  template: ImageTemplate;
  title: string;
  prize: string;
  date?: string;
  logo?: Buffer | null;
  usePlatformLogo?: boolean;
}): Promise<Buffer> {
  const W = 1280;
  const H = 720;
  const L = 72;

  let logo = opts.logo ?? null;
  if (!logo && opts.usePlatformLogo) logo = await readFile(path.resolve(env.BRAND_LOGO_PATH)).catch(() => null);
  const logoLayer = logo ? [{ input: await sharp(logo).resize({ height: 72, width: 260, fit: 'inside' }).png().toBuffer(), top: 40, left: L }] : [];

  if (opts.background) {
    return sharp(opts.background).resize(W, H, { fit: 'cover' }).composite(logoLayer).jpeg({ quality: 92 }).toBuffer();
  }

  const base = sharp(
    Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0648AA"/><stop offset="0.55" stop-color="#0071E3"/><stop offset="1" stop-color="#2997FF"/></linearGradient>
      <radialGradient id="r" cx="0.76" cy="0.5" r="0.42"><stop offset="0" stop-color="#fff" stop-opacity="0.30"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    </defs><rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/></svg>`),
  );

  // ---- left column: title, prize pill, date (vertically centred block)
  const textW = 600;
  const { size: tSize, lines } = fitTitle(opts.title, textW);
  const lead = tSize * 1.08;
  const prizeFont = font('Onest-Bold');
  const pSize = 32;
  const prize = opts.prize.length > 40 ? opts.prize.slice(0, 39) + '…' : opts.prize;
  const pillH = 64;
  const pillW = Math.min(textW, Math.ceil(width(prizeFont, prize, pSize)) + 96);
  const blockH = (lines.length - 1) * lead + tSize * 0.78 + 30 + pillH + (opts.date ? 60 : 0);
  const top = (H - blockH) / 2;
  const firstBaseline = top + tSize * 0.78;
  const titleSvg = lines.map((l, i) => textPath(font('Unbounded-ExtraBold'), l, L, firstBaseline + i * lead, tSize, '#fff', 0)).join('');
  const pillY = firstBaseline + (lines.length - 1) * lead + 30;
  const pillSvg = `<g filter="url(#shadow)"><rect x="${L}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="#fff"/></g>
    ${star(L + 38, pillY + pillH / 2, 15)}
    ${textPath(prizeFont, prize, L + 64, pillY + pillH / 2 + pSize * 0.36, pSize, '#0071E3')}`;
  const dateSvg = opts.date ? textPath(font('Onest-Medium'), opts.date, L, pillY + pillH + 50, 28, '#fff', 0, 'opacity="0.9"') : '';

  // ---- right side: the real gift
  let giftSvg = '';
  if (opts.giftImage) {
    const png = await sharp(opts.giftImage).resize(460, 460, { fit: 'inside' }).png().toBuffer();
    const meta = await sharp(png).metadata();
    const gw = meta.width ?? 460;
    const gh = meta.height ?? 460;
    const x = 975 - gw / 2;
    const y = 365 - gh / 2;
    // opaque artwork (collectibles from Fragment come with their own backdrop) gets rounded card corners
    const stats = await sharp(png).stats();
    const opaque = stats.isOpaque || (stats.channels.length === 4 && stats.channels[3]!.min >= 250);
    giftSvg = opaque
      ? `<defs><clipPath id="gc"><rect x="${x}" y="${y}" width="${gw}" height="${gh}" rx="44"/></clipPath></defs>
         <g filter="url(#giftShadow)"><rect x="${x}" y="${y}" width="${gw}" height="${gh}" rx="44" fill="#fff"/></g>
         <image href="data:image/png;base64,${png.toString('base64')}" x="${x}" y="${y}" width="${gw}" height="${gh}" clip-path="url(#gc)"/>`
      : `<image href="data:image/png;base64,${png.toString('base64')}" x="${x}" y="${y}" width="${gw}" height="${gh}" filter="url(#giftShadow)"/>`;
  } else {
    giftSvg = star(975, 360, 170);
  }
  giftSvg += sparkle(1195, 125, 30) + sparkle(752, 140, 18, 0.9) + sparkle(1185, 610, 22, 0.9) + star(1160, 235, 26) + star(780, 610, 20);

  const layer = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${DEFS}
  ${giftSvg}
  <g filter="url(#shadow)">${titleSvg}</g>
  ${pillSvg}
  ${dateSvg}
</svg>`;

  return base
    .composite([...(await patternTile()), { input: Buffer.from(layer), top: 0, left: 0 }, ...logoLayer])
    .jpeg({ quality: 92 })
    .toBuffer();
}
