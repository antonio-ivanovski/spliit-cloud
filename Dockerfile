# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14-slim AS base
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

FROM installer AS source-builder
COPY --from=pruner /app/out/full/ ./
COPY --from=prisma /app/packages/db/src/generated ./packages/db/src/generated

FROM source-builder AS api-builder
# Regenerate the OpenAPI spec during build — the source is gitignored and
# excluded from turbo prune's `out/full/`. Keep generation in the full-dependency
# builder because @trpc/openapi requires TypeScript tooling. Enable MCP with
# non-routable placeholders so the generated document includes the optional
# OAuth/assistant surface as well.
RUN NODE_ENV= \
  ENABLE_MCP=true \
  MCP_PUBLIC_URL=https://mcp-build.invalid \
  ASSISTANT_CONFIRMATION_SECRET=assistant-build-secret-at-least-32-bytes \
  bun run apps/api/scripts/generate-openapi.ts
RUN bun --filter @spliit/api bundle:runtime

FROM base AS api
ENV NODE_ENV=production
RUN mkdir -p /data
COPY --from=api-builder /app/apps/api/dist/server.js ./apps/api/dist/server.js
COPY --from=api-builder /app/apps/api/openapi.json ./apps/api/openapi.json
EXPOSE 3001
CMD ["bun", "run", "apps/api/dist/server.js"]

FROM installer AS migrate
ENV NODE_ENV=production
COPY --from=pruner /app/out/full/ ./
CMD ["bun", "run", "--filter", "@spliit/db", "prisma-migrate"]

FROM source-builder AS worker-builder
RUN bun --filter @spliit/worker bundle:runtime

FROM base AS worker
ENV NODE_ENV=production
RUN mkdir -p /data
COPY --from=worker-builder /app/apps/worker/dist/server.js ./apps/worker/dist/server.js
EXPOSE 3003
CMD ["bun", "run", "apps/worker/dist/server.js"]

FROM installer AS mcp-builder
ENV NODE_ENV=production
COPY --from=pruner /app/out/full/ ./
# mcp-use imports the server while compiling widgets. These non-routable
# origins are build-time placeholders only; the runtime MCP image requires
# MCP_PUBLIC_URL, MCP_API_URL, and MCP_WEB_URL from deployment env. Clear
# NODE_ENV so runtime-only widget-domain preparation does not run before
# mcp-use has created the manifest.
RUN NODE_ENV= MCP_API_URL=https://api-build.invalid MCP_PUBLIC_URL=https://mcp-build.invalid MCP_WEB_URL=https://web-build.invalid bun --filter @spliit/mcp build
RUN bun --filter @spliit/mcp bundle:runtime
RUN find apps/mcp/dist -type f -name '*.map' -delete

FROM node:24.12.0-bookworm-slim AS mcp
WORKDIR /app/apps/mcp
ENV NODE_ENV=production
COPY --from=mcp-builder /app/apps/mcp/dist ./dist
EXPOSE 3002
CMD ["node", "dist/runtime.mjs"]
