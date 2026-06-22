FROM node:24-alpine

WORKDIR /usr/app

RUN apk add --no-cache openssl && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/domain/package.json ./packages/domain/package.json

RUN pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN pnpm --filter @spliit/db prisma-generate && pnpm --filter @spliit/api build

EXPOSE 3001/tcp

ENTRYPOINT ["/bin/sh", "/usr/app/scripts/container-entrypoint.sh"]
