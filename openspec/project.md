# Project Context

## Purpose

Spliit is a free, open-source expense splitting application (Splitwise alternative). Users create groups, add participants, track shared expenses, and calculate who owes whom. The app aims to be simple, privacy-respecting, and easy to self-host.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript (strict mode)
- **Database**: PostgreSQL with Prisma ORM
- **API**: tRPC for type-safe client-server communication
- **Styling**: TailwindCSS + shadcn/UI components
- **State**: React Query (via tRPC) + React Hook Form
- **i18n**: next-intl with JSON message files
- **Validation**: Zod schemas
- **Hosting**: Vercel (official) or self-hosted via Docker

## Project Conventions

### Code Style

- **Formatting**: Prettier with `prettier-plugin-organize-imports`
- **Linting**: ESLint extending `next/core-web-vitals`
- **Path aliases**: `@/*` maps to `./src/*`
- **Component files**: PascalCase for components (e.g., `GroupForm.tsx`)
- **Utility files**: kebab-case (e.g., `recurring-expenses.ts`)
- **No emojis** in code unless explicitly requested

### Architecture Patterns

- **App structure**:

  - `src/app/` - Next.js App Router pages and API routes
  - `src/components/` - Reusable React components
  - `src/components/ui/` - shadcn/UI primitives
  - `src/lib/` - Business logic, utilities, Prisma client
  - `src/trpc/` - tRPC router definitions and client setup
  - `prisma/` - Database schema and migrations
  - `messages/` - i18n translation JSON files
  - `tests/` - E2E tests with Playwright

- **tRPC patterns**:

  - Routers organized under `src/trpc/routers/`
  - Each procedure in its own file (e.g., `create.procedure.ts`)
  - Use `baseProcedure` from `src/trpc/init.ts`
  - Input validation with Zod schemas
  - superjson transformer for Decimal handling

- **Database**:
  - Prisma schema in `prisma/schema.prisma`
  - Models: Group, Participant, Expense, ExpensePaidFor, Category, Activity
  - Amounts stored as integers (cents) to avoid floating-point issues
  - Cascade deletes on related entities

### Testing Strategy

- **Unit tests**: Jest in `src/**/*.test.ts`

  - Run: `npm run test`
  - Focus on business logic (balances, totals, schemas)
  - Use helper factories (e.g., `makeExpense()`) for test data

- **E2E tests**: Playwright in `tests/`
  - Run: `npm run test-e2e`
  - Test helpers in `tests/helpers/` for navigation and API seeding
  - Tests use both UI interactions and direct tRPC calls

### Git Workflow

- **Commit style**: Lowercase, imperative (e.g., `fix: eliminate flaky E2E tests`)
- **Prefixes used**: `fix:`, `refactor:`, `chore:`, or no prefix for features
- **Branch strategy**: Feature branches merged to main

## Domain Context

- **Group**: Container for participants and expenses with a default currency
- **Participant**: Person in a group who can pay for or be part of expenses
- **Expense**: A cost entry with title, amount, date, category, payer, and split info
- **Split modes**: EVENLY, BY_SHARES, BY_PERCENTAGE, BY_AMOUNT
- **Reimbursement**: Special expense type to record debt settlements
- **Balance**: Calculated from expenses - tracks who paid vs who owes
- **Currency**: Stored as integer cents; supports multi-currency with conversion rates

## Important Constraints

- Amounts must remain integers (cents) to prevent rounding errors
- No user authentication - groups accessed via shareable URLs
- Privacy-first: no tracking, minimal data collection
- Must remain self-hostable with simple Docker setup
- Feature flags control opt-in features (S3 uploads, OpenAI integration)

## External Dependencies

- **PostgreSQL**: Primary database (Vercel Postgres or self-hosted)
- **AWS S3** (optional): Expense document/image storage via next-s3-upload
- **OpenAI API** (optional): Receipt scanning and category extraction
- **Weblate**: Translation management (hosted.weblate.org/projects/spliit)
