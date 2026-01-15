# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Spliit is a free, open-source expense-splitting application built with Next.js. It allows groups to track shared expenses and automatically calculate who owes whom. The stack includes:

- **Frontend**: Next.js with React, TailwindCSS, and shadcn/UI components
- **Backend**: tRPC for type-safe RPC procedures
- **Database**: PostgreSQL with Prisma ORM
- **State Management**: React Query (@tanstack/react-query)
- **Internationalization**: next-intl for multi-language support
- **Styling**: TailwindCSS with shadcn/UI components

## Development Commands

### Build, Test, and Lint

```bash
npm run dev              # Start development server (http://localhost:3000)
npm run build            # Build for production
npm start                # Start production server
npm run lint             # Run ESLint
npm check-types          # Type checking with TypeScript
npm check-formatting     # Check Prettier formatting
npm prettier -w src      # Format code with Prettier
npm test                 # Run Jest tests
npm test -- --watch      # Run tests in watch mode
npm test -- path/to/file.test.ts  # Run specific test file
```

### Database and Migrations

```bash
./scripts/start-local-db.sh  # Start local PostgreSQL container
npx prisma migrate dev       # Run pending migrations
npx prisma studio          # Open Prisma Studio (GUI for database)
npx prisma generate        # Regenerate Prisma Client
```

### Docker and Deployment

```bash
npm run build-image      # Build Docker image
npm run start-container  # Start app and postgres containers (uses container.env)
```

### Other Commands

```bash
npm run generate-currency-data  # Generate currency list data
```

## Architecture

### Directory Structure

- **`src/app/`** - Next.js 13+ App Router pages and layouts. Contains page files, API routes under `api/`, and group-related pages under `groups/`. Server Components and Server Actions live here.

- **`src/components/`** - Reusable React components, mostly UI components from shadcn/UI patterns. Organized by feature areas.

- **`src/trpc/`** - Type-safe backend procedures:
  - `init.ts` - tRPC configuration and transformer setup (uses SuperJSON for Prisma.Decimal serialization)
  - `routers/` - Organized by domain (groups, categories) with individual `*.procedure.ts` files per operation
  - `query-client.ts` - React Query client setup

- **`src/lib/`** - Utility functions and helpers:
  - `balances.ts` - Balance calculation logic
  - `totals.ts` - Expense total calculations
  - `currency.ts` - Currency formatting and conversion
  - `featureFlags.ts` - Runtime feature flag management (opt-in features like S3 documents, receipt scanning, category extraction)
  - `env.ts` - Environment variable validation
  - `schemas.ts` - Zod validation schemas
  - `prisma.ts` - Prisma client singleton

- **`src/i18n/`** - Internationalization setup using next-intl

- **`src/scripts/`** - Utility scripts (currency data generation, migrations)

### Data Model (Prisma)

Key entities and relationships:

- **Group** - Container for a group of people splitting expenses. Stores name, currency, and information.
- **Participant** - Person within a group.
- **Expense** - Represents money paid by one participant, optionally split among others. Supports:
  - Different split modes: `EVENLY`, `BY_SHARES`, `BY_PERCENTAGE`, `BY_AMOUNT`
  - Reimbursements (flagged with `isReimbursement`)
  - Recurring expenses via `RecurringExpenseLink`
  - Document attachments (photos/receipts)
  - Original currency tracking with conversion rates
- **ExpensePaidFor** - Junction table mapping expenses to participants with share amounts
- **Category** - Categorize expenses (id, grouping, name)
- **Activity** - Audit log of group changes (updates, expense creation/deletion)
- **ExpenseDocument** - Photos or receipts attached to expenses

### tRPC Router Structure

The tRPC API follows a modular pattern where each domain (groups, categories) is a router composed of smaller routers (expenses, balances, activities, stats) and procedures. Each procedure is in its own file (e.g., `create.procedure.ts`, `list.procedure.ts`) for clarity.

Example: `groups.expenses.create()`, `groups.balances.list()`, `groups.activities.list()`

Procedures use Zod for input validation. SuperJSON transformer handles Prisma.Decimal serialization automatically.

### Server vs Client

- Server Components by default in Next.js 13+ App Router
- Server Actions for mutations from the UI
- Client-side React Query hooks wrapping tRPC calls
- Use `'use client'` and `'use server'` directives as needed

### Features and Configuration

Optional features controlled via environment variables:

- **Expense Documents (S3)**: `NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS` - Upload and attach images to expenses (requires AWS S3 setup)
- **Receipt Scanning**: `NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT` - Extract expense details from receipt photos using OpenAI GPT-4 Vision (requires S3 and OpenAI API)
- **Auto Category Extraction**: `NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT` - Suggest categories based on expense title using OpenAI (requires OpenAI API)

## Common Development Tasks

### Adding a New tRPC Procedure

1. Create a new file in the appropriate router directory (e.g., `src/trpc/routers/groups/expenses/newAction.procedure.ts`)
2. Import `baseProcedure` from `@/trpc/init`, define input with Zod, and implement the procedure
3. Export from the router's `index.ts` file
4. Add the procedure to the router composition in the parent router

### Adding a UI Component

- Use shadcn/UI components from `src/components/ui/` as building blocks
- Follow existing patterns: create component files in `src/components/` organized by feature
- For forms, use React Hook Form with Zod schema validation

### Database Changes

1. Update `prisma/schema.prisma`
2. Run `npx prisma migrate dev` to create a migration
3. Commit the migration file and schema changes

### Testing

- Jest is configured for unit tests
- Write tests in `*.test.ts` or `*.test.tsx` files
- React Testing Library is available for component testing

## Key Implementation Details

### Decimal Handling

Amounts in the database are stored as integers (cents). Prisma.Decimal type is used for precise calculations. SuperJSON transformer in tRPC init automatically serializes/deserializes these values.

### Localization

- Uses `next-intl` for multi-language support via URL segments (e.g., `/en/groups/...`, `/fr/groups/...`)
- Language configuration in `src/i18n/request.ts`
- Translations managed via Weblate (see README)

### Recurring Expenses

RecurringExpenseLink connects recurring expenses to their "current frame" expense. The design allows independent deletion of each recurring instance. Future instances are not pre-linked; they're created as standalone expenses with their own RecurringExpenseLink.

## Environment Variables

See `.env.example` for required and optional variables. Key ones:

- `POSTGRES_PRISMA_URL` - PostgreSQL connection string (pooled)
- `POSTGRES_URL_NON_POOLING` - Direct PostgreSQL connection
- `NEXT_PUBLIC_DEFAULT_CURRENCY_CODE` - Default currency code for new groups
- `NEXT_PUBLIC_ENABLE_*` - Feature flags (require `OPENAI_API_KEY` and/or S3 credentials)

## Health Check Endpoints

- `GET /api/health/readiness` - Full health check (database connectivity)
- `GET /api/health/liveness` - Application running check
- `GET /api/health` - Alias for readiness

## Troubleshooting

- **Database connection issues**: Ensure PostgreSQL is running and connection strings in `.env` are correct
- **Type errors**: Run `npm check-types` to see all issues
- **Prisma Client issues**: Run `npx prisma generate` to regenerate client
- **S3 or OpenAI features not working**: Verify environment variables are set and API credentials are valid
