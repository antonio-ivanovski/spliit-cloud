# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS base
WORKDIR /app

FROM base AS pruner
ARG APP_SCOPE
COPY . .
RUN test -n "$APP_SCOPE"
RUN --mount=type=cache,target=/root/.bun/install/cache bunx turbo@2.10.7 prune "$APP_SCOPE" --docker

FROM base AS installer
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/bun.lock ./bun.lock
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

# Generate the Prisma client from schema inputs only so app-source-only
# commits can reuse this layer via BuildKit content hashing.
FROM installer AS prisma
COPY --from=pruner /app/out/full/packages/db/prisma ./packages/db/prisma
COPY --from=pruner /app/out/full/packages/db/prisma.config.ts ./packages/db/prisma.config.ts
RUN mkdir -p packages/db/src \
  && bun --filter @spliit/db prisma-generate

FROM base AS runner
ENV NODE_ENV=production
RUN mkdir -p /data
COPY --from=installer /app ./
COPY --from=pruner /app/out/full/ ./
COPY --from=prisma /app/packages/db/src/generated ./packages/db/src/generated

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

FROM runner AS worker
EXPOSE 3003
CMD ["bun", "run", "apps/worker/src/server.ts"]

FROM installer AS mcp-builder
ENV NODE_ENV=production
COPY --from=pruner /app/out/full/ ./
# mcp-use imports the server while compiling widgets. These non-routable
# origins are build-time placeholders only; the runtime MCP image requires
# MCP_PUBLIC_URL, MCP_API_URL, and MCP_WEB_URL from deployment env. Clear
# NODE_ENV so runtime-only widget-domain preparation does not run before
# mcp-use has created the manifest.
RUN NODE_ENV= MCP_API_URL=https://api-build.invalid MCP_PUBLIC_URL=https://mcp-build.invalid MCP_WEB_URL=https://web-build.invalid bun --filter @spliit/mcp build

FROM node:24.12.0-bookworm-slim AS mcp
WORKDIR /app/apps/mcp
ENV NODE_ENV=production
COPY --from=mcp-builder /app /app
EXPOSE 3002
CMD ["node", "dist/index.js"]
