# Data for import

## gifts.json
Telegram gift IDs supplied by the platform owner. Format:

```json
[
  { "telegramGiftId": "5170233102089322756", "name": "Teddy Bear", "type": "REGULAR", "emoji": "🧸", "imageUrl": "/gifts/teddy.png", "starCost": 15 },
  { "telegramGiftId": "...", "name": "Vice Cream", "type": "COLLECTIBLE", "collection": "Vice Cream", "rarity": "rare" }
]
```

`type`: REGULAR | LIMITED | COLLECTIBLE | REMOVED | NFT.
Import: `npm run import:gifts` (or Admin → Подарки → Импорт). After import, every id is verified
against `getAvailableGifts`; an id alone never makes a gift "sendable".
Gift images: put files into `apps/web/public/gifts/` and reference them as `/gifts/<file>`.

## premium-emoji.json
```json
[{ "customEmojiId": "5368324170671202286", "name": "Подарок", "category": "gifts", "fallback": "🎁" }]
```
Import: `npm run import:emoji`. Previews are fetched with `getCustomEmojiStickers`.
