# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS base
WORKDIR /app

FROM base AS pruner
ARG APP_SCOPE
COPY . .
RUN test -n "$APP_SCOPE"
RUN --mount=type=cache,target=/root/.bun/install/cache bunx turbo@2.9.18 prune "$APP_SCOPE" --docker

FROM base AS installer
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/bun.lock ./bun.lock
RUN --mount=type=cache,target=/root/.bun/install/cache bun install

FROM base AS runner
ENV NODE_ENV=production
RUN mkdir -p /data
COPY --from=installer /app ./
COPY --from=pruner /app/out/full/ ./
RUN bun --filter @spliit/db prisma-generate

FROM runner AS api
EXPOSE 3001
CMD ["bun", "run", "apps/api/src/server.ts"]

FROM runner AS migrate
CMD ["bun", "--filter", "@spliit/db", "prisma-migrate"]
