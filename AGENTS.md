# AGENTS.md

Spliit is a Bun monorepo: React/Vite web app, Hono+tRPC API, Prisma/PostgreSQL DB, and shared domain package.

## Commands

Use Bun, not npm/yarn.

```bash
bun install
bun dev                  # web :3000, api :3001
bun check-types
bun check-formatting
bun run test             # Vitest unit tests through turbo
bun test-e2e             # Playwright; starts web/API via config
bun prisma-generate
bun prisma-migrate       # deploy migrations for local/container DB
```

## Paths

- `apps/web/`: React SPA. Routes are registered in `apps/web/src/router.tsx`; page components live under `apps/web/src/app/`.
- `apps/api/`: Hono server. tRPC procedures live in `apps/api/src/trpc/routers/`; business logic is in `apps/api/src/lib/api.ts`.
- `packages/domain/`: shared Zod schemas, split/balance math, currency, recurrence, i18n metadata.
- `packages/db/`: Prisma schema/migrations and Prisma client singleton.

## Easy-to-miss Rules

- Money is stored as integer cents. `BY_PERCENTAGE` split shares are basis points: `2500` means 25%.
- Keep tRPC procedures thin: validate with Zod, call shared/domain/API logic, and compose in router `index.ts` files.
- Import Prisma from `@spliit/db`; the generated client lives under `packages/db/src/generated/` and is intentionally not the public import path.
- When changing schema, commit `packages/db/prisma/schema.prisma` and the migration together, then run `bun prisma-generate`.
- API runs TypeScript directly with Bun; do not add an API build step unless changing the runtime model.
- Docker API stage runs `bun run apps/api/src/server.ts`; add another server as a new `FROM runner AS <name>` stage with its own `CMD`.
- Keep code comments terse. JSDoc/inline comments should explain the _why_ (non-obvious behavior, constraints, seams) in a sentence or two, not re-narrate the code. When in doubt, drop the comment.

More focused notes: [.agent/architecture.md](.agent/architecture.md), [.agent/database.md](.agent/database.md), [.agent/testing.md](.agent/testing.md), [.agent/trpc-procedures.md](.agent/trpc-procedures.md).

## Translations

`apps/web/src/messages/en-US.json` is the source of truth; other locales fall back to it at runtime. **Never hand-edit** any file in `apps/web/src/messages/` — use the `bun i18n` CLI. For the full workflow (adding strings, translating into other locales, listing what a git change introduces), load the `translate-strings` skill at `.agents/skills/translate-strings/SKILL.md`.
