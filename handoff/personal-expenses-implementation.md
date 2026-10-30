# Personal expenses — implementation brief

Status: in progress. This file is the coordination contract for the feature;
update it as slices land.

## Product decisions (locked)

- Personal is its own account-owned ledger. **No wallet accounts, balances,
  transfers, or net worth.**
- Personal entries are income or expense, in integer minor units.
- Group/friend expenses can be linked into Personal at **the holder's share
  only**. Settlements never count.
- Inclusion is opt-in at every level: master off by default → per-group opt-in
  (with an include-from date) → per-expense INCLUDE/EXCLUDE overrides.
- Linked entries are **materialized rows**, not editable copies: amount, date,
  title follow the group; personal category/note/exclusion override; leaving a
  group freezes a snapshot.
- CSV/bank import and batch categorization are in scope and must reuse the
  group tools through target adapters.
- Adjacent capabilities (filters/cursor, export, insights, attachments,
  recurrence) are planned, implemented behind the same workspace abstraction.
- Effect TS is used for the orchestration modules touched here; pure domain
  math stays plain.

## Data model

Migration: `packages/db/prisma/migrations/20261023192254_personal_expenses`.

- `PersonalProfile` (accountId PK, currencyCode, timeZone, sharedEnabled)
- `PersonalTransaction` (kind, signed amount, currency + original currency,
  date, categoryId, title, note, version, source PERSONAL|GROUP,
  sourceExpenseId/GroupId/GroupName, sourceDetachedAt)
- `PersonalGroupRule` (accountId, groupId, included, includeFrom)
- `PersonalExpenseOverride` (accountId, expenseId, state INCLUDE|EXCLUDE|null,
  categoryId)
- `PersonalBudget` (name, amount, currencyCode, period, timeZone,
  categoryScope, categoryIds, startDay, archived)

## Domain contract

`packages/domain/src/personal.ts` exports:

- schemas: `personalTransactionCreateSchema`, `personalTransactionUpdateSchema`,
  `personalBudgetInputSchema`, `personalGroupRuleInputSchema`,
  `personalExpenseOverrideInputSchema`, `personalEntryFilterSchema`
- `resolvePersonalInclusion` — master/group/override/share/settlement policy
- `getPersonalMonthBounds`, `getPreviousPersonalMonthBounds`
- `calculatePersonalBudgetUsage`, `getPersonalBudgetStatus`,
  `personalBudgetMatchesCategory`, `normalizePersonalBudgetCategories`,
  `pickOverallPersonalBudget`, `sumPersonalBudgetAmounts`
- cursor codec: `encodePersonalEntryCursor`, `decodePersonalEntryCursor`

## API contract (tRPC `personal.*`)

All procedures are `protectedProcedure` and take the account from the session;
never accept an account id from the client.

```
profile.get                    -> PersonalProfileDto
profile.update                 -> PersonalProfileDto
transactions.list(filter)      -> { entries, nextCursor, totals }
transactions.create({ requestId, entry }) -> { id }
transactions.update({ id, entry })        -> { id }
transactions.delete({ id })               -> { ok: true }
transactions.setCategory({ id, categoryId }) -> { id }
transactions.exclude({ id })              -> { ok: true }   // linked rows
overview.get({ month? })       -> PersonalOverviewDto
budgets.list                   -> { budgets, overallBudget }
budgets.create/update/archive/delete
sources.list                   -> { profile, groups }
sources.updateRule             -> { synced }
sources.setExpenseOverride     -> { included }
sources.reconcile              -> { synced }
expenses.getStatus({ expenseId }) -> { eligible, included, override }
```

DTO shapes (keep web and API aligned):

```ts
type PersonalEntryDto = {
  id: string
  kind: 'EXPENSE' | 'INCOME'
  amount: number
  currencyCode: string
  originalAmount: number | null
  originalCurrency: string | null
  date: string // YYYY-MM-DD
  categoryId: string
  title: string | null
  note: string | null
  version: number
  source: 'PERSONAL' | 'GROUP'
  group: { id: string; name: string } | null
  canEdit: boolean
}

type PersonalBudgetDto = {
  id: string
  name: string
  amount: number
  currencyCode: string
  categoryScope: 'ALL' | 'SELECTED'
  categoryIds: string[]
  spent: number
  remaining: number
  ratio: number
  projected: number
  state: 'OK' | 'TRENDING' | 'OVER'
}

type PersonalOverviewDto = {
  month: string
  currencyCode: string
  spent: number
  income: number
  net: number
  previousSpent: number
  delta: number
  categories: Array<{ categoryId: string; amount: number; percentage: number }>
  recent: PersonalEntryDto[]
  budgets: PersonalBudgetDto[]
  overallBudget: PersonalBudgetDto | null
  shared: {
    enabled: boolean
    count: number
    amount: number
    groups: Array<{
      groupId: string
      name: string
      count: number
      amount: number
    }>
  }
}
```

## Web

- `/personal` overview, `/personal/transactions`, `/personal/budgets`,
  `/personal/settings`; create/edit routes are focused mobile flows.
- Desktop left rail, mobile bottom tabs. BudgetBakers feel: month switcher,
  big spent number, category donut, budget bars with projection, recent list,
  "From your groups" card.
- Feature gated by `PUBLIC_ENABLE_PERSONAL_FINANCE` (client hides nav/routes).
- Reuse `AmountInput`, `CategorySelector`, `CategoryIcon`, `DateInput`,
  `ResponsiveDialog`, `Card`, `Progress`, `Badge`, recharts patterns.
- i18n: `bun i18n add` only. Never edit `apps/web/src/messages/*`.

## Inclusion sync

`syncPersonalExpense(expenseId)` runs after group expense create/update and
removes rows on delete. It loads `paidFor` shares, computes
`calculateShares`, resolves each holder's policy, converts the ledger-currency
share into the profile currency at the expense date, and upserts/deletes the
`PersonalTransaction` with `source = GROUP`.

`syncPersonalGroup(accountId, groupId)` backfills from `includeFrom`; turning a
group off deletes non-pinned rows and routes each `INCLUDE`-pinned expense
through the single-expense path, so pins refresh on model changes, are
deleted when model-excluded (master off, zero share, settlement), and stay
frozen when detached.

`reconcilePersonalEntries(accountId?)` is the repair path for missed hooks.

Never write group `Expense` rows from personal code. Never emit activities,
webhooks, or group notifications for personal writes.

## Slices

1. Schema + domain (done).
2. API core: profile, transactions, overview, budgets, sources, sync hooks.
3. Web shell + overview + transactions + quick add + budgets + settings.
4. Shared CSV import (target adapter + generic provenance).
5. Shared categorization (target adapter + run scope).
6. Entry surface: filters/cursor, export, insights; then attachments and
   recurrence.

## Validation

- `bun --filter @spliit/domain test`
- `bun --filter @spliit/api test`
- `bun --filter @spliit/web test`
- `bun check` / `bun lint:fix` / `bun format` on touched packages.
- E2E smoke: `bun --filter @spliit/api start:e2e` + web dev + Playwright.

## Implemented in this pass

- Personal ledger: transactions (expense/income), monthly budgets, dashboard,
  transaction list + filters/cursor, quick add, settings.
- Linked group/friend expenses with master/group/per-expense opt-in, share-based
  materialization, category overrides, exclusion, freeze-on-leave/group-delete,
  rename propagation, and sync hooks for create/update/delete, bulk category
  changes, CSV import, and recurring materialization.
- CSV/bank import: worker-based parse/mapping/review, income inference,
  duplicate detection against personal **and** linked shared rows, provenance,
  idempotent atomic commit, and re-check/back-to-mapping recovery.
- Category intelligence: one-off title suggestions in quick add, a
  "Smart categorize" quick batch action over uncategorized rows
  (dictionary/history first, AI only when the deployment allows it), and a
  reviewed batch-categorization run at `/personal/transactions/categorize`
  with the same calibration/review/apply lifecycle as groups (local mode or
  System One when configured). Personal runs are scope `PERSONAL`/account id
  via the shared run/table/progress/paged-review engine and a personal target
  adapter: native/detached rows update in place with version CAS; live GROUP
  rows update in place plus a `PersonalExpenseOverride` upsert (never group
  `Expense` writes, activities, webhooks, or group budget enqueue); personal
  budgets stay read-computed. Group runs stay byte-for-byte identical.
  Migration `20261024180336_bulk_categorization_scope` adds
  `scopeType`/`scopeId` (+ `@@unique([scopeType, scopeId])`, nullable `groupId`,
  `personalAccountId` FK `User` `onDelete: Cascade` so account deletion removes
  personal runs) and row `itemType`/`itemId` (PK `[runId, itemId]`, backfilled
  from `EXPENSE`/`expenseId`; `expenseVersion`/`expenseDate` names retained).
- CSV export with filters, 10k cap signalling, and spreadsheet-formula
  sanitization.
- Receipt/image/PDF attachments on native Personal entries (`PersonalAttachment`,
  migration `20261024185732_personal_attachments`): `uploads.personalPresign`
  (account-scoped `tmp/personal/<accountId>/` keys, same 120/hour presign
  budget, group presign contract unchanged) plus
  `personal.transactions.attachments.add/remove` (PERSONAL-only, max 10 per
  entry, tmp→`documents/personal/<accountId>/` promotion on add, version CAS
  with CONFLICT, best-effort S3 cleanup on remove/transaction delete/account
  deletion). Add is race-safe (`SELECT ... FOR UPDATE` on the parent, cap
  counted inside the transaction); a failed add deletes a newly promoted
  object (pre-existing destinations are never deleted); S3 deletes are
  reference-counted so a URL shared by two rows survives until the last row
  is gone. Group-sourced linked rows stay snapshot-only and reject
  attachments. Web: shared `useDocumentUpload` hook (group behavior
  byte-identical), injected `uploadFile` path on `ExpenseDocumentsInput`,
  `PersonalAttachmentsCard` in the entry detail (gated by
  `enableExpenseDocuments`), 10-attachment cap with a limit note (shared
  `ExpenseDocumentsInput` `maxDocuments`, single-toast validation owned by the
  shared component), paperclip indicator on rows, no OCR.
- Planned/recurring personal transactions (`PersonalRecurringSeries`,
  migration `20261024195421_personal_recurring`): account-owned series with
  DAILY/WEEKLY/MONTHLY/YEARLY frequency, interval 1-99, INDEFINITE/COUNT/DATE
  ends, immutable schedule, editable template (amount/kind/category/title/note)
  applying to future occurrences only, pause/resume (resume skips overdue
  without backfilling), skip-next, cancel (keeps history), hard-delete only
  when no rows were generated, and a read-only Upcoming projection. The worker
  materializes due occurrences into normal `PersonalTransaction` rows
  (`source = PERSONAL`, `personal.recurring.materialize` /
  `personal-recurring.reconcile` jobs with DLQs and an hourly cron); group
  recurring behavior is unchanged, and generated rows carry no group inclusion,
  activity, webhook, notification, budget, or sync fan-out. Editing a generated
  row detaches it from its series. Web: `/personal/recurring` + Planned nav
  tab, create/edit dialog reusing `getRecurrencePreviewDates` /
  `getRecurrenceSchedule` from the shared `lib/recurrence-schedule` module
  (group form re-exports it), overview Upcoming card, repeat badge on generated
  rows.
- E2E smoke: add expense, budget progress, CSV import, linked group expense,
  categorize entry, planned/Upcoming, and pause (7 personal paths; 24 total).

## Remaining limitations

No known P0/P1 defects remain in the completed slices. These are intentional
bounds or toolchain follow-ups, not unfinished functional paths:

- `apps/web/src/routeTree.gen.ts` has a one-line manual union entry for
  `/personal/transactions_/categorize`; the TanStack generator currently
  crashes in this environment (`babel-dead-code-elimination` toolchain
  mismatch). Re-run the generator when the toolchain is fixed and confirm both
  non-nested routes.
- Personal attachment promotion is covered by unit tests with mocked S3 and by
  the shared group upload pipeline; there is no CI E2E that requires MinIO.
- Personal recurring materialization/reconcile is covered by unit and real-DB
  integration tests; E2E covers Upcoming/pause, not worker catch-up.
- The account bundle is a backup, not a group-import source; the group importer
  is intentionally unchanged. Personal quick-add does not stage attachments
  before the entry exists (attach from entry detail).
- No OCR/receipt extraction for personal attachments.
- Effect is used for the personal inclusion/reconcile service. Import and
  categorization reuse the existing Promise-based engines through shared
  identity helpers and a categorization target adapter; a full Effect migration
  of those engines remains a separate refactor.
- Personal entries are not part of offline snapshots (there is no personal
  offline cache).
- Multi-account bank CSVs import into one personal ledger; provenance is
  recorded but there is no account dimension.

## Validation

- `bun check` (33 tasks) passes.
- Domain 1378, API unit 2288, Web 3069, Jobs 36, Worker 27, DB 15 tests pass.
- API integration 391 tests pass on the real DB, including all personal suites.
- Full Playwright suite 24 tests pass; the personal smoke path covers add,
  budget, CSV import, linked group expense, categorize entry,
  planned/Upcoming, and pause.
- Fresh database: `prisma migrate deploy` applies all 66 migrations cleanly.
- `bun i18n check --changes-only` passes for all 31 locales.

## Effect usage

Effect is used for the personal inclusion/reconcile service
(`apps/api/src/lib/personal/inclusion.ts`) because it fans out across accounts,
performs FX conversion, and needs typed best-effort post-commit failures. The
import commit and categorization flows reuse the existing Promise-based
engines through shared identity helpers and a categorization target adapter;
a full Effect migration of those engines remains a separate refactor.
