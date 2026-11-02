# SOLIK

SaaS-платформа для Telegram-конкурсов: розыгрыши Telegram Gifts, Stars и NFT, SMS Counter, «Перебивка», первый комментарий, конкурс 777, подарки за активность, AI-посты, White-Label боты, централизованные рассылки и аналитика.

```
apps/
  api/   Fastify + TypeScript + Prisma (PostgreSQL) + BullMQ (Redis)
         ├─ src/server.ts    HTTP API + webhooks всех ботов
         └─ src/worker.ts    фоновые очереди: таймеры, выдача призов, AI, рассылки, подписки
  web/   Next.js 15 + React 19 + Tailwind + Framer Motion — Telegram Mini App и веб-версия
data/    ID подарков и Premium Emoji для импорта
docs/    документация
```

## Деплой одним контейнером (порт 3000)

```bash
docker build -t solik .
docker run -p 3000:3000 --env-file .env solik
```
Нужны внешние PostgreSQL и Redis. Подробнее — в [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Быстрый старт (Docker Compose)

```bash
cp .env.example .env      # заполните токен бота, URL, ключи
docker compose up -d --build
```

После старта API сам применяет миграции, регистрирует главного бота, ставит webhook и меню.
Затем импортируйте подарки и эмодзи: Админ-панель → «Подарки и эмодзи» или `npm run import:gifts`.

Подробности: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Локальная разработка

Нужны Node 20+, PostgreSQL 16 и Redis 7.

```bash
npm install
cp .env.example .env               # NODE_ENV=development, DATABASE_URL, REDIS_URL
npm run db:migrate
npm run dev:api                    # :4000
npm run dev:worker
npm run dev:web                    # :3000 (проксирует /api на :4000)
```

Для webhook'ов нужен публичный HTTPS-адрес, например через `cloudflared tunnel --url http://localhost:4000`. Его указывают в `PUBLIC_API_URL`.

## Тесты

```bash
npm test                                         # unit + HTTP-интеграционные (без БД)
TEST_DATABASE_URL=postgresql://… REDIS_URL=… npm test   # + сквозной сценарий webhook → SMS → победитель
```

## Что умеет

| Модуль | Где |
|---|---|
| Главный бот: меню, «Создать бота», Mini App | `apps/api/src/bot/mainMenu.ts` |
| White-Label боты: подключение, профиль, подписка 100 ⭐/мес | `modules/bots`, `modules/subscriptions` |
| Конкурсы: мастер из 9 шагов, публикация, таймеры | `modules/contests`, `web/app/contests/new` |
| Перебивка: инвойсы Stars или платные сообщения чата, отсчёт 10…1 | `modules/auction` |
| SMS Counter: `.sms 100`, очередь призов по позициям | `modules/sms` |
| Первый комментарий, подарки за сообщения (вкл. шанс %), активность | `modules/activity` |
| Конкурс 777 (🎰 = 64) | `modules/dice` |
| Winner Engine: crypto RNG, блокировки, перевыбор, аудит | `modules/winners` |
| Gift Delivery: sendGift / Business transferGift / Premium / ручная | `modules/gifts` |
| AI: Gemini-тексты и картинки + Sharp/SVG-композиция | `modules/ai` |
| Шаблоны, Premium Emoji, GIF, переменные, Telegram Preview | `templates/`, `web/components` |
| Админ-панель: боты, чаты, подписки, тарифы, рассылки, логи | `http/routes/admin.ts`, `web/app/admin` |

## Документация

- [ARCHITECTURE.md](docs/ARCHITECTURE.md): устройство системы и ограничения Telegram
- [API.md](docs/API.md): REST API
- [DATABASE.md](docs/DATABASE.md): схема БД
- [DEPLOYMENT.md](docs/DEPLOYMENT.md): развёртывание
- [SECURITY.md](docs/SECURITY.md): безопасность
- [BOT_SETUP.md](docs/BOT_SETUP.md): главный и White-Label боты, чаты, каналы
- [AI_SETUP.md](docs/AI_SETUP.md): Gemini
- [GIFT_SETUP.md](docs/GIFT_SETUP.md): подарки, Business, NFT
