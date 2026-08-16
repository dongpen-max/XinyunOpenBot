FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY services/sync-gateway ./services/sync-gateway
RUN pnpm install --frozen-lockfile --prod
ENV HOST=0.0.0.0 PORT=8788 SYNC_DATABASE_PATH=/data/sync-gateway.sqlite
VOLUME ["/data"]
EXPOSE 8788
CMD ["node", "--experimental-strip-types", "services/sync-gateway/src/index.ts"]
