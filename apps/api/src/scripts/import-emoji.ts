import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { mainApi } from '../telegram/registry.js';

// Usage: npm run import:emoji -- [path/to/premium-emoji.json]   (default: ../../data/premium-emoji.json)
const file = process.argv[2] ?? path.resolve(process.cwd(), '../../data/premium-emoji.json');
const items = z
  .array(z.object({ customEmojiId: z.string().regex(/^\d{5,25}$/), name: z.string(), category: z.string().default('general'), fallback: z.string().optional() }))
  .parse(JSON.parse(await readFile(file, 'utf8')));
let ok = 0;
for (let i = 0; i < items.length; i += 200) {
  const chunk = items.slice(i, i + 200);
  const stickers = await mainApi.getCustomEmojiStickers(chunk.map((e) => e.customEmojiId)).catch(() => []);
  const byId = new Map(stickers.map((s) => [s.custom_emoji_id, s]));
  for (const e of chunk) {
    const s = byId.get(e.customEmojiId);
    await prisma.premiumEmoji.upsert({
      where: { customEmojiId: e.customEmojiId },
      create: { ...e, fallback: e.fallback ?? s?.emoji ?? '⭐', stickerFileId: s?.thumbnail?.file_id ?? s?.file_id, isActive: !!s },
      update: { name: e.name, category: e.category, stickerFileId: s?.thumbnail?.file_id ?? s?.file_id, isActive: !!s },
    });
    if (s) ok++;
  }
}
console.log(`imported ${items.length}, verified by Telegram: ${ok}`);
await prisma.$disconnect();
