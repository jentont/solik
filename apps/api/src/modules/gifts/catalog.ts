import { z } from 'zod';
import type { GiftAvailability, GiftType } from '@prisma/client';
import { audit } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import { mainApi } from '../../telegram/registry.js';

export const giftImportSchema = z.array(
  z.object({
    telegramGiftId: z.string().regex(/^\d{5,25}$/),
    name: z.string().min(1).max(100),
    type: z.enum(['REGULAR', 'LIMITED', 'COLLECTIBLE', 'REMOVED', 'NFT']).default('REGULAR'),
    imageUrl: z.string().max(500).optional(),
    emoji: z.string().max(16).optional(),
    collection: z.string().max(100).optional(),
    rarity: z.string().max(50).optional(),
    starCost: z.number().int().optional(),
    totalCount: z.number().int().optional(),
  }),
);

/** Imports gift ids supplied by the platform owner (data/gifts.json or admin panel). */
export async function importGifts(items: z.infer<typeof giftImportSchema>, actorId?: string) {
  let created = 0;
  let updated = 0;
  for (const g of items) {
    const exists = await prisma.telegramGift.findUnique({ where: { telegramGiftId: g.telegramGiftId } });
    await prisma.telegramGift.upsert({
      where: { telegramGiftId: g.telegramGiftId },
      create: { ...g, availability: g.type === 'REMOVED' ? 'REMOVED' : 'UNKNOWN' },
      update: { name: g.name, type: g.type, imageUrl: g.imageUrl, emoji: g.emoji, collection: g.collection, rarity: g.rarity, starCost: g.starCost, totalCount: g.totalCount },
    });
    exists ? updated++ : created++;
  }
  await audit('gifts.import', { actorId, meta: { created, updated } });
  // An id is not proof the gift can be sent — verify against the live API
  const verify = await verifyGiftsWithTelegram().catch((e) => ({ error: String(e) }));
  return { created, updated, verify };
}

/**
 * Checks which gifts a bot can actually send right now (getAvailableGifts).
 * Gifts missing from that list are marked non-transferable → manual delivery.
 */
export async function verifyGiftsWithTelegram() {
  const { gifts } = await mainApi.getAvailableGifts();
  const live = new Map(gifts.map((g) => [g.id, g]));
  for (const g of gifts) {
    const availability: GiftAvailability = g.remaining_count === 0 ? 'SOLD_OUT' : 'AVAILABLE';
    const type: GiftType | undefined = g.total_count ? 'LIMITED' : undefined;
    await prisma.telegramGift.upsert({
      where: { telegramGiftId: g.id },
      create: {
        telegramGiftId: g.id,
        name: g.sticker.emoji ? `Gift ${g.sticker.emoji}` : `Gift ${g.id.slice(-6)}`,
        emoji: g.sticker.emoji,
        stickerFileId: g.sticker.file_id,
        type: type ?? 'REGULAR',
        starCost: g.star_count,
        upgradeStarCost: g.upgrade_star_count,
        totalCount: g.total_count,
        remainingCount: g.remaining_count,
        transferable: availability === 'AVAILABLE',
        availability,
        lastVerifiedAt: new Date(),
      },
      update: {
        stickerFileId: g.sticker.file_id,
        emoji: g.sticker.emoji,
        starCost: g.star_count,
        upgradeStarCost: g.upgrade_star_count,
        totalCount: g.total_count,
        remainingCount: g.remaining_count,
        transferable: availability === 'AVAILABLE',
        availability,
        lastVerifiedAt: new Date(),
        ...(type ? { type } : {}),
      },
    });
  }
  const stale = await prisma.telegramGift.updateMany({
    where: { telegramGiftId: { notIn: [...live.keys()] }, type: { in: ['REGULAR', 'LIMITED'] }, transferable: true },
    data: { transferable: false, availability: 'UNKNOWN', lastVerifiedAt: new Date() },
  });
  return { available: gifts.length, markedUnavailable: stale.count };
}
