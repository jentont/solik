# Развёртывание

## Один контейнер, порт 3000 (сборка из GitHub)

Корневой `Dockerfile` собирает весь SOLIK в один образ: Web App, API и worker. Наружу открыт только **порт 3000**: `/api/*`, `/webhook/*` и `/health` проксирует веб-сервер. Подходит для хостингов, которые собирают Docker-образ из репозитория.

1. Подключите репозиторий к хостингу, выберите сборку по `Dockerfile`, порт **3000**.
2. Нужны внешние PostgreSQL и Redis (обычно это дополнения хостинга).
3. Переменные окружения:
   - `DATABASE_URL`, `REDIS_URL`
   - `MAIN_BOT_TOKEN`, `PLATFORM_OWNER_IDS`
   - `PUBLIC_API_URL` и `WEB_APP_URL` — **один и тот же** публичный адрес сервиса, например `https://solik.example.com`
   - `JWT_SECRET`, `ENCRYPTION_KEY` (`openssl rand -hex 32`), `GEMINI_API_KEY`
4. Подключите постоянный том к `/data`: там хранятся загруженные медиа.

При старте контейнер применяет миграции, ставит webhook главного бота и запускает все процессы. Если один процесс падает, контейнер завершается, и хостинг его перезапускает.

Локальная проверка образа:
```bash
docker build -t solik .
docker run -p 3000:3000 --env-file .env solik
```

## Несколько сервисов (docker-compose)

## Требования
- Сервер с Docker и Docker Compose.
- Два HTTPS-домена или поддомена: API (webhook'и Telegram) и Web App. Telegram принимает webhook только по HTTPS на портах 443, 80, 88 или 8443.
- Токен главного бота из @BotFather.

## Шаги

1. `cp .env.example .env` и заполните значения:
   - `MAIN_BOT_TOKEN`, `NEXT_PUBLIC_MAIN_BOT_USERNAME`, `PLATFORM_OWNER_IDS` (ваш Telegram ID);
   - `PUBLIC_API_URL=https://api.ваш-домен`, `WEB_APP_URL=https://app.ваш-домен`;
   - `POSTGRES_PASSWORD`, `JWT_SECRET` (`openssl rand -base64 48`), `ENCRYPTION_KEY` (`openssl rand -hex 32`);
   - `GEMINI_API_KEY` (см. AI_SETUP.md).
2. Положите логотип в `apps/web/public/brand/logo.png` и `apps/api/assets/logo.png`. Логотип не генерируется.
3. `docker compose up -d --build`.
4. Настройте reverse-proxy (Caddy или Nginx) с TLS:
   ```
   api.example.com { reverse_proxy localhost:4000 }
   app.example.com { reverse_proxy localhost:3000 }
   ```
5. В @BotFather для главного бота:
   - `/setdomain` → `app.example.com` (Login Widget);
   - Bot Settings → Configure Mini App → URL `https://app.example.com`;
   - `/setjoingroups` → Enable.
   - Privacy mode можно не трогать: бот-администратор и так видит все сообщения.
6. Откройте бота, нажмите /start, затем «Открыть». Ваш аккаунт получит роль OWNER.
7. Админ-панель → «Подарки и эмодзи» → импортируйте ID и нажмите «Проверить через Telegram».

При старте API применяет миграции, регистрирует главного бота, ставит webhook и кнопку меню.

## Обновление
```bash
git pull && docker compose up -d --build
```

## Масштабирование
- `worker` можно запустить в нескольких экземплярах: `docker compose up -d --scale worker=3`. Таймеры, рассылки и выдача идемпотентны.
- `api` масштабируется за балансировщиком: состояние хранится в PostgreSQL и Redis.
- Redis запущен с AOF и `noeviction`: отложенные задачи (таймеры) переживают его перезапуск. Если очередь потеряна, worker восстанавливает её из БД при старте.

## Резервные копии
- `pg_dump` ежедневно.
- `ENCRYPTION_KEY` храните отдельно: без него токены White-Label ботов не расшифровать.
- Том `uploads` с медиа.

## Мониторинг
- `GET /health`.
- Админ-панель → «Логи и интеграции»: БД, Redis, webhook главного бота, AI, ошибки webhook'ов, выдачи и AI.
