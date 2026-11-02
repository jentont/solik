# Build context: repository root
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/
RUN npm install -w apps/web --include-workspace-root=false --no-audit --no-fund
COPY apps/web apps/web
ARG NEXT_PUBLIC_MAIN_BOT_USERNAME
ENV NEXT_PUBLIC_MAIN_BOT_USERNAME=$NEXT_PUBLIC_MAIN_BOT_USERNAME
# API_INTERNAL_URL is read at build time by next.config rewrites
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
RUN cd apps/web && npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN useradd -r -u 10001 solik
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER solik
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
