import type { NFTAsset } from '@prisma/client';

/**
 * External NFT providers. A provider may declare `canTransfer` only when it has a
 * confirmed, signed integration with its network/marketplace. No fake transactions.
 *
 * To add TON / marketplace support: implement `transfer` with the real SDK and
 * custody configuration, register it here, and document required env vars in GIFT_SETUP.md.
 */
export interface NftProvider {
  id: string;
  name: string;
  canTransfer: boolean;
  transfer(asset: NFTAsset, recipientTgId: bigint): Promise<string>;
}

const manual: NftProvider = {
  id: 'manual',
  name: 'Ручная передача',
  canTransfer: false,
  async transfer() {
    throw new Error('manual provider cannot transfer');
  },
};

// Telegram collectible (unique) gifts are transferred via Business connections
// (prize.businessOwnedGiftId → BUSINESS_TRANSFER), not via this provider registry.
const telegramGift: NftProvider = {
  id: 'telegram-gift',
  name: 'Telegram Collectible Gift',
  canTransfer: false,
  async transfer() {
    throw new Error('use BUSINESS_TRANSFER for Telegram collectible gifts');
  },
};

const ton: NftProvider = {
  id: 'ton',
  name: 'TON NFT',
  canTransfer: false, // requires wallet custody integration (see GIFT_SETUP.md)
  async transfer() {
    throw new Error('TON provider is not configured');
  },
};

export const nftProviders: Record<string, NftProvider> = {
  [manual.id]: manual,
  [telegramGift.id]: telegramGift,
  [ton.id]: ton,
};
