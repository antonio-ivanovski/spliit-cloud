# Database Notes

- Prisma schema: `packages/db/prisma/schema.prisma`.
- Migrations: `packages/db/prisma/migrations/`.
- Public Prisma import: `import { prisma } from '@spliit/db'`.
- Generated Prisma client output is `packages/db/src/generated/prisma/client`; do not import it directly outside `packages/db`.
- `DATABASE_URL` is required. Set `PRISMA_QUERY_LOG=true` only when query logging is needed.

## Schema Changes

1. Edit `packages/db/prisma/schema.prisma`.
2. Create/commit the migration with the schema change.
3. Run `bun prisma-generate`.
4. Run `bun check-types`.

## Query Rules

- Use `include` for relations needed by callers; avoid follow-up queries that can drift from the main read.
- Use transactions when an operation must update activity logs, recurrence links, or multiple related records atomically.
- Preserve cascades in the schema when adding relations under groups, participants, expenses, or activities.

## Money/Splits

- Store money as cents: `100` is `$1.00`.
- `BY_PERCENTAGE` uses basis points: `2500` is `25%`.
- `BY_AMOUNT` stores cents directly in `ExpensePaidFor.shares`.
