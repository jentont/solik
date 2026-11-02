# База данных

PostgreSQL 16, Prisma ORM. Схема: `apps/api/prisma/schema.prisma`, миграции: `apps/api/prisma/migrations`.

```bash
npm run db:migrate     # dev: создать/применить миграции
npm run db:deploy      # prod: применить (api делает это при старте контейнера)
```

## Сущности

| Группа | Модели |
|---|---|
| Пользователи и доступ | `User` (role USER/ADMIN/OWNER), `AdminRole` (права), `Subscription` (тариф аккаунта) |
| Боты | `TelegramBot` (isPlatform, зашифрованный токен, профиль White-Label), `BotUser` (кто начал диалог — единственные адресаты рассылок по пользователям) |
| Чаты | `TelegramChat` (группы/супергруппы/обсуждения, `ChatStatus`, права, счётчики), `TelegramChannel` (каналы, ссылка на группу обсуждения), `ChannelPost` (пост → ветка комментариев) |
| Business | `TelegramBusinessConnection` (права), `BusinessOwnedGift` (подарки аккаунта) |
| Конкурсы | `Contest` (тип `ContestType`, статус, config JSON, состояние таймера и ставок), `ContestPrize`, `ContestParticipant`, `ContestWinner` (drawNumber, REROLLED, seed), `ContestEvent` (журнал) |
| SMS | `SmsCounter` (1:1 с Contest), `SmsCounterParticipant` |
| Призы | `TelegramGift`, `GiftDelivery` (статусы PENDING/PROCESSING/DELIVERED/FAILED/MANUAL_REQUIRED), `StarsTransaction` (ставки), `NFTAsset` |
| Контент | `MessageTemplate`, `PremiumEmoji`, `MediaFile`, `MediaTelegramFile` (file_id на каждого бота), `AIJob` |
| White-Label | `WhiteLabelPlan` (цена в Stars), `BotSubscription` (слот на бота; PENDING/ACTIVE/GRACE/EXPIRED/CANCELLED), `SubscriptionPayment` |
| Рассылки | `Broadcast`, `BroadcastRecipient` (`@@unique([broadcastId, chatTgId])`) |
| Системные | `WebhookEvent` (`@@unique([botKey, updateId])`), `ActivityLog`, `PlatformSetting` |

## Ключевые инварианты (уникальные индексы)

- `TelegramBot.telegramId`: один бот принадлежит одному владельцу.
- `ContestParticipant(contestId, tgUserId)`: участник регистрируется один раз.
- `SmsCounterParticipant(counterId, position)`: позиции не повторяются.
- `ContestWinner(contestId, drawNumber, place)`: место в розыгрыше занято один раз.
- `StarsTransaction.telegramPaymentChargeId` и `SubscriptionPayment.telegramPaymentChargeId`: платёж учитывается один раз.
- `GiftDelivery.idempotencyKey`: один приз — одна выдача.
- `WebhookEvent(botKey, updateId)`: обновление обрабатывается один раз.

## Транзакции

Регистрация в SMS, ставки, определение победителей, мгновенные призы и оплата подписки выполняются в интерактивных транзакциях с `SELECT … FOR UPDATE` по соответствующей строке.

## Хранение данных

Истечение подписки не удаляет данные: бот переводится в `SUBSCRIPTION_EXPIRED`, конкурсы, участники и история сохраняются. `WebhookEvent` без ошибок старше 7 дней удаляются ежедневной задачей.
