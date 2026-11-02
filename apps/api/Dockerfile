# Build context: repository root (see docker-compose.yml)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
RUN npm install -w apps/api --include-workspace-root=false --no-audit --no-fund

FROM deps AS build
COPY apps/api apps/api
RUN cd apps/api && npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app/apps/api
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && useradd -r -u 10001 solik
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/apps/api/package.json ./package.json
COPY apps/api/assets ./assets
RUN mkdir -p /data/uploads && chown -R solik /data
USER solik
EXPOSE 4000
# API applies pending migrations on start; the worker image overrides CMD.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
