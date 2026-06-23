# AGENTS.md

Spliit is an open-source expense-splitting app (React SPA + Hono + tRPC + Prisma + PostgreSQL) running on Bun.

## Commands

```bash
bun install          # Install deps and generate bun.lock
bun dev              # Web at localhost:3000 and API at localhost:3001
bun build            # Production build (web only; API runs via Bun directly)
bun check-types      # TypeScript check
bun check-formatting # Prettier check
bun run test         # Unit tests (vitest, via turbo)
bun test-e2e         # Playwright e2e tests
bun prisma-generate  # Generate Prisma client
bun prisma-migrate   # Apply Prisma migrations (also runs in compose migrate service)
```

## Container

```bash
bun start-container                      # docker compose up
docker compose run --rm migrate          # re-run migrations manually
```

The Dockerfile is multi-stage (`pruner` -> `installer` -> `runner` -> `api`) and runs the API directly with `bun run apps/api/src/server.ts`. Add a new server by introducing a new `FROM runner AS <name>` stage with its own `CMD`.

## Directory Structure

- `apps/web/` - Vite React SPA, TanStack Router routes, shadcn/UI components
- `apps/api/` - Hono server, tRPC routers, API routes (runs directly under Bun, no build step)
- `packages/domain/` - Shared schemas, calculations, currency, i18n metadata
- `packages/db/prisma/schema.prisma` - Database schema and migrations
- `packages/db/src/` - Prisma client singleton

## Key Patterns

**Data**

- Amounts stored as integers (cents). 100 = $1.00
- `BY_PERCENTAGE` splits use basis points (2500 = 25%)

**Frontend**

- Vite React SPA with TanStack Router
- shadcn/UI components in `apps/web/src/components/ui/`
- Forms: React Hook Form + Zod + shadcn `<Form>`
- tRPC hooks via `trpc.domain.procedure.useQuery/useMutation()`
- i18n uses `i18next`/`react-i18next`

**Backend**

- tRPC procedures in `apps/api/src/trpc/routers/`, one file per operation
- Zod for input validation on all procedures
- Business logic in `apps/api/src/lib/api.ts`, procedures are thin wrappers
- Hono hosts `/trpc/*`, `/health/*`, export routes, and upload presign routes
- Bun runs TS directly. No build/bundle step.

**Database**

- Prisma ORM, schema at `packages/db/prisma/schema.prisma`
- Queries use `include` for relations, not separate fetches

## Detailed Docs

- [Architecture](.agent/architecture.md) - Data model, tRPC structure, directory details
- [Database](.agent/database.md) - Prisma patterns, migrations, queries
- [Testing](.agent/testing.md) - Vitest/Playwright patterns, helpers, factories
- [tRPC Procedures](.agent/trpc-procedures.md) - Adding new procedures, router composition
