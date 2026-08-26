FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
RUN npm ci

FROM deps AS builder
COPY . .
ENV DATABASE_MODE=sqlite \
    SQLITE_DATABASE_PATH=/tmp/build.db
RUN node scripts/init-db.mjs
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ARG GIT_COMMIT_SHA
ARG GIT_COMMIT_MESSAGE
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Shanghai \
    DATABASE_MODE=sqlite \
    GIT_COMMIT_SHA=$GIT_COMMIT_SHA \
    GIT_COMMIT_MESSAGE=$GIT_COMMIT_MESSAGE \
    SQLITE_DATABASE_PATH=/data/inventory.db

RUN mkdir -p /data && chown -R node:node /app /data
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/db ./db
COPY --from=builder --chown=node:node /app/scripts/init-db.mjs /app/scripts/cron-refresh.mjs ./scripts/
COPY --chown=node:node docker/entrypoint.sh ./docker/entrypoint.sh

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["sh", "./docker/entrypoint.sh"]
CMD ["node", "server.js"]
