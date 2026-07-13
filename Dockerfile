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
# Regenerate the OpenAPI spec during build — the source is gitignored and
# excluded from turbo prune's `out/full/`, so the runner stage doesn't
# carry a copy. `NODE_ENV=` overrides the runner-stage `ENV NODE_ENV=production`
# to avoid env validation requiring BETTER_AUTH_SECRET / SMTP_HOST /
# EMAIL_FROM at build time; the spec is derived from TypeScript types
# and Zod schemas, so runtime env values don't affect the output.
RUN NODE_ENV= bun run apps/api/scripts/generate-openapi.ts
EXPOSE 3001
CMD ["bun", "run", "apps/api/src/server.ts"]

FROM runner AS migrate
CMD ["bun", "--filter", "@spliit/db", "prisma-migrate"]
