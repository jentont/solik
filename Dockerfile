# SOLIK - single image: web (PORT, default 3000) + API + worker.
# PostgreSQL and Redis are embedded and keep their data in /app/data, unless DATABASE_URL / REDIS_URL are set.
# Code lives in /usr/src/app (not /app): hosts like Bothost bind-mount the git checkout over /app,
# only /app/data is the persistent volume.
FROM node:22-bookworm-slim AS build
WORKDIR /usr/src/app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY apps apps
COPY data data
# the web server proxies /api and /webhook to the API inside the same container
ENV API_INTERNAL_URL=http://127.0.0.1:4000 NEXT_TELEMETRY_DISABLED=1
RUN cd apps/api && npx prisma generate && npm run build
RUN cd apps/web && npm run build

FROM node:22-bookworm-slim
WORKDIR /usr/src/app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 DATA_DIR=/app/data
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates postgresql redis-server \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/data && chmod 777 /app/data
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/apps/api/dist ./apps/api/dist
COPY --from=build /usr/src/app/apps/api/prisma ./apps/api/prisma
COPY --from=build /usr/src/app/apps/api/package.json ./apps/api/package.json
COPY --from=build /usr/src/app/apps/api/assets ./apps/api/assets
COPY --from=build /usr/src/app/data ./data
# Next.js standalone server
COPY --from=build /usr/src/app/apps/web/.next/standalone ./web
COPY --from=build /usr/src/app/apps/web/.next/static ./web/apps/web/.next/static
COPY --from=build /usr/src/app/apps/web/public ./web/apps/web/public
COPY docker/start.mjs ./start.mjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "start.mjs"]
