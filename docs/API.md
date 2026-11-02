# REST API

Базовый путь: `/api`. Формат — JSON. Telegram ID передаются строками.

**Авторизация:**
- Mini App: `POST /api/auth/telegram-webapp {initData}` → `{token}`, затем `Authorization: Bearer <token>`.
- Веб-версия: `POST /api/auth/telegram-login` (данные Login Widget) → httpOnly cookie `solik_session`. Изменяющие запросы с cookie требуют заголовок `x-solik-csrf: 1`.

**Ошибки:** `{ error: CODE, message, details? }`. Коды: 400 (валидация), 401, 403, 404 (ресурс не найден или чужой), 402 (лимит или подписка), 409 (конфликт состояния), 429.

## Аутентификация
| Метод | Путь | |
|---|---|---|
| POST | `/auth/telegram-webapp` | вход из Mini App |
| POST | `/auth/telegram-login` | вход через Login Widget |
| POST | `/auth/dev` | только `ALLOW_DEV_LOGIN=true` и не production |
| POST | `/auth/logout` | |
| GET | `/me` | текущий пользователь |

## Боты, чаты, каналы
| Метод | Путь | |
|---|---|---|
| GET | `/bots` | бот платформы и собственные боты со статистикой |
| POST | `/bots` | `{token}` — подключить White-Label бота (нужен свободный слот подписки) |
| GET | `/bots/:id` | карточка: чаты, каналы, подписка, Business |
| PATCH | `/bots/:id/profile` | имя, описание, приветствие, команды, меню, аватар |
| PATCH | `/bots/:id/settings` | `defaultPrizeId`, `smsPrizeQueue` |
| POST | `/bots/:id/check` · `/enable` · `/disable` | |
| DELETE | `/bots/:id` | |
| GET | `/bots/:id/stars-balance` | баланс Stars бота |
| GET | `/chats` | чаты и каналы пользователя |
| GET | `/channels/:id/posts` | посты канала (для First Comment и SMS) |
| POST | `/chats/:id/refresh` | перепроверить права бота |
| DELETE | `/chats/:id` | отключить (статус `DISCONNECTED`) |

## Конкурсы
| Метод | Путь | |
|---|---|---|
| GET | `/contests?status=&type=&botId=&q=&page=` | |
| POST | `/contests` | создать черновик (см. схему ниже) |
| PATCH | `/contests/:id` | только `DRAFT`/`SCHEDULED` |
| GET | `/contests/:id` | с призами, победителями, выдачами, ставками, журналом |
| POST | `/contests/:id/start` | `{now?}` — опубликовать или запланировать |
| POST | `/contests/:id/stop` | отмена |
| POST | `/contests/:id/winner` | `{reroll?}` — определить или перевыбрать победителей |
| POST | `/contests/:id/archive` | |
| DELETE | `/contests/:id` | только черновик |
| GET | `/contests/:id/participants` · `/leaderboard` | |
| GET | `/winners` | история победителей |

```jsonc
// POST /api/contests
{
  "botId": "…", "chatId": "…" /* или */, "channelId": "…", "channelPostId": 123,
  "type": "RANDOM|STARS_AUCTION|FIRST_COMMENT|MESSAGE_GIVEAWAY|ACTIVITY|GIFTS|NFT|DICE_777",
  "title": "…", "winnersCount": 1, "startsAt": "ISO", "endsAt": "ISO",
  "config": { /* зависит от типа, см. ARCHITECTURE.md */ },
  "postText": "<b>…</b> {prize_name}", "postMediaId": "…", "postButtons": [{"text":"…","url":"https://…"}],
  "prizes": [{ "kind": "GIFT", "title": "Teddy Bear", "giftId": "…", "quantity": 1 }]
}
```

## SMS Counter
| Метод | Путь | |
|---|---|---|
| POST | `/sms-counter/start` | `{botId, chatId, channelPostId?, mode, target, everyN?, announceEvery?, prizes[]}` |
| POST | `/sms-counter/stop` | `{contestId}` |
| GET | `/sms-counter/stats` | |

## Подарки, выдача, Business, NFT
| Метод | Путь | |
|---|---|---|
| GET | `/gifts/catalog?type=&q=&onlyAvailable=` | с рассчитанным способом выдачи |
| GET | `/gifts/:id/sticker` | превью стикера (прокси, токен не раскрывается) |
| GET | `/gifts/deliveries?status=` | история выдачи |
| POST | `/gifts/deliver` | ручная выдача `{botId, recipientTgId, giftId}` |
| POST | `/gifts/deliveries/:id/retry` · `/confirm` | повтор / отметить выданным |
| GET | `/business` · POST `/business/:id/refresh` · `/sync-gifts` · DELETE `/business/:id` | |
| GET/POST/DELETE | `/nft`, `/nft/:id` | |

## Контент
| Метод | Путь | |
|---|---|---|
| POST | `/media/upload` | multipart `file`, `asAnimation` |
| GET | `/media?kind=` · DELETE `/media/:id` | |
| GET | `/media/:id/file?sig=` | подписанная ссылка |
| GET | `/templates/meta` · `/templates` | |
| POST/PUT/DELETE | `/templates`, `/templates/:id` | |
| POST | `/templates/render` | серверный рендер (именно то, что получит Telegram) |
| POST | `/templates/test` | тест-отправка себе |
| GET | `/emoji` · `/emoji/:customEmojiId/preview` | |
| POST | `/ai/generate` · `/ai/image` | ставят задачу; результат: GET `/ai/jobs/:id` |
| GET | `/ai/templates` | стили изображений |

## Подписки и аналитика
| Метод | Путь | |
|---|---|---|
| GET | `/billing` | тарифы и подписки пользователя |
| POST | `/billing/subscribe` | `{planId?, autoRenew}` → `{link}` (Stars-инвойс) |
| POST | `/billing/:id/renew` · `/auto-renew {enabled}` | |
| GET | `/dashboard` | |
| GET | `/analytics?from&to&botId&chatId&contestId&prizeKind` | |

## Админ (роль ADMIN/OWNER; помеченные * — только OWNER)
`/admin/stats`, `/admin/bots` (+ `/:id`, `/:id/suspend`, `/:id/resume`), `/admin/chats` (+ `/:id`), `/admin/users` (+ `/:id/role`*, `/:id/block`), `/admin/contests`, `/admin/subscriptions`, `/admin/plans` (POST*, PATCH*), `/admin/gifts/import`, `/admin/gifts/verify`, `/admin/gifts/:id`, `/admin/emoji/import`, `/admin/emoji/:id`, `/admin/logs`, `/admin/errors`, `/admin/integrations`, `/admin/settings` (PUT*), `/admin/broadcasts` (+ `/:id`, `/:id/preview`, `/:id/test`, `/:id/start {confirm:true}`, `/:id/stop`), `/admin/broadcast-targets`.

Каждый изменяющий админ-запрос записывается в `ActivityLog`.

## Webhook
`POST /webhook/:botId`. Заголовок `X-Telegram-Bot-Api-Secret-Token` обязателен.
