# Architecture

## Directory Structure

- **`src/app/`** - Next.js App Router pages and layouts. Contains page files, API routes under `api/`, and group-related pages under `groups/`.

- **`src/components/`** - Reusable React components, mostly shadcn/UI patterns. Organized by feature areas.

- **`src/trpc/`** - Type-safe backend procedures:

  - `init.ts` - tRPC configuration (uses SuperJSON for Prisma.Decimal serialization)
  - `routers/` - Organized by domain (groups, categories) with individual `*.procedure.ts` files
  - `query-client.ts` - React Query client setup

- **`src/lib/`** - Utility functions and helpers:

  - `balances.ts` - Balance calculation logic
  - `totals.ts` - Expense total calculations
  - `currency.ts` - Currency formatting and conversion
  - `featureFlags.ts` - Runtime feature flag management
  - `env.ts` - Environment variable validation
  - `schemas.ts` - Zod validation schemas
  - `prisma.ts` - Prisma client singleton

- **`src/i18n/`** - Internationalization setup using next-intl

## Data Model (Prisma)

Key entities:

- **Group** - Container for people splitting expenses. Stores name, currency, info.
- **Participant** - Person within a group.
- **Expense** - Money paid by one participant, split among others. Supports:
  - Split modes: `EVENLY`, `BY_SHARES`, `BY_PERCENTAGE`, `BY_AMOUNT`
  - Reimbursements (flagged with `isReimbursement`)
  - Recurring expenses via `RecurringExpenseLink`
  - Document attachments (photos/receipts)
  - Original currency tracking with conversion rates
- **ExpensePaidFor** - Junction table mapping expenses to participants with share amounts
- **Category** - Expense categorization (id, grouping, name)
- **Activity** - Audit log of group changes
- **ExpenseDocument** - Photos or receipts attached to expenses

## tRPC Router Structure

Modular pattern: each domain (groups, categories) is a router composed of smaller routers and procedures. Each procedure in its own file (e.g., `create.procedure.ts`).

Example: `groups.expenses.create()`, `groups.balances.list()`, `groups.activities.list()`

Procedures use Zod for input validation. SuperJSON handles Prisma.Decimal serialization.

### Adding a New tRPC Procedure

1. Create file in router directory (e.g., `src/trpc/routers/groups/expenses/newAction.procedure.ts`)
2. Import `baseProcedure` from `@/trpc/init`, define input with Zod, implement procedure
3. Export from router's `index.ts`
4. Add procedure to router composition in parent router

## Key Implementation Details

### Decimal Handling

Amounts stored as integers (cents). Prisma.Decimal used for precise calculations. SuperJSON transformer auto-serializes these values.

### Localization

- Uses `next-intl` via URL segments (e.g., `/en/groups/...`, `/fr/groups/...`)
- Config in `src/i18n/request.ts`
- Translations managed via Weblate

### Recurring Expenses

RecurringExpenseLink connects recurring expenses to their "current frame" expense. Allows independent deletion of each instance. Future instances created as standalone expenses with own RecurringExpenseLink.

## Database Commands

```bash
./scripts/start-local-db.sh  # Start local PostgreSQL container
npx prisma migrate dev       # Run pending migrations
npx prisma studio            # Open Prisma Studio GUI
npx prisma generate          # Regenerate Prisma Client
```

## Docker

```bash
npm run build-image      # Build Docker image
npm run start-container  # Start app and postgres containers
```
