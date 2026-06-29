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
bun test:integration     # Real-DB integration tests (API + web)
bun prisma-generate
bun prisma-migrate       # deploy migrations for local/container DB
```

## Integration tests

The project has two kinds of integration tests that hit a real PostgreSQL database:

- **API integration tests** (`apps/api/src/integration/`): Test tRPC procedures against a real database using `createCaller`. Covers group CRUD, expense CRUD, invitations (email + link), and email flows.
- **Web integration tests** (`apps/web/src/tests/integration/`): Render React components with the real TRPCProvider, connecting to the existing API server. Covers group/expense rendering with data created via the real API.

### Running integration tests

```bash
bun run test:integration
```

**Prerequisites:**

- The test PostgreSQL database must be running (same connection as API dev: `postgresql://test:test@localhost:5432/test` or `DATABASE_URL` env var).
- Migrations must be up to date (`bun prisma-migrate`).
- For the **web integration tests**, the API server must be running on port 3001 (`bun dev` from project root or `bun --filter @spliit/api dev`).

### ⚠️ Agent rules for integration tests

- **Never start the dev server.** The integration tests assume an existing API server on port 3001. If the server is not running, the tests will fail with a clear error message.
- If you need the server running and it is not, **ask the user for explicit permission** before starting it.
- The API real-DB tests (`apps/api/src/integration/`) do not need a running server — they call tRPC procedures directly via `createCaller`. They only need the database.

### Test architecture

| Suite                                 | Command                | DB needed | API server needed | Speed   |
| ------------------------------------- | ---------------------- | --------- | ----------------- | ------- |
| Unit tests (mock)                     | `bun test`             | No        | No                | ~3s     |
| API integration (real DB)             | `bun test:integration` | Yes       | No                | ~5s     |
| Web integration (real API)            | `bun test:integration` | Yes       | Yes               | ~5s     |
| E2E (Playwright) (broken, do not run) | `bun test-e2e`         | Yes       | Starts both       | Minutes |

Default `bun test` runs all mock-based tests and skips integration suites.

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

`apps/web/src/messages/en-US.json` is the source of truth; other locales fall back to it at runtime. **Never hand-edit** any file in `apps/web/src/messages/` — use the `bun i18n` CLI.

- **Audit (canonical CI gate)**: `bun i18n check` exits 1 if any non-English locale is missing any key present in en-US, or if there are orphan keys. Use `bun i18n check --changes-only` for PR-scoped audits (only flag keys introduced by the current diff vs `HEAD`).
- **Translate**: load the `translate-strings` skill at `.agents/skills/translate-strings/SKILL.md`. When many locales are behind, dispatch **parallel subagents grouped by language family** (Romance, Germanic+Nordic, Slavic, East Asian, Other) — each subagent owns one language family, runs the skill, and finishes by confirming `bun i18n check --locale <own-locale>` exits 0.
