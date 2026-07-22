## Why

Recurring expenses are currently materialized as a side effect of reading group expenses, so creation is neither timely nor durable and concurrent reads can race. Spliit also needs a reusable background-work foundation for future asynchronous features, making this the right point to replace the legacy recurrence chain with an explicit series model and a PostgreSQL-backed worker.

## What Changes

- Add a pg-boss worker service with scheduled execution, retries, dead-letter handling, reconciliation, and operator visibility.
- **BREAKING** Replace `Expense.recurrenceRule` and `RecurringExpenseLink` with an authoritative recurrence-series model linked to ordered expense occurrences.
- Support repeat intervals of 1–99 days, weeks, months, or years, with indefinite, total-count, or inclusive end-date termination.
- Materialize all due past occurrences, schedule future occurrences from the entered expense date, and prevent duplicate creation under retries or concurrent workers.
- Treat the series occurrence counter as a monotonic record of consumed schedule slots. Deleting a materialized occurrence never decrements progress, creates a tombstone, or leaves a history placeholder.
- Support three explicit recurring delete actions: delete this occurrence; delete this and following materialized occurrences while continuing the series; or delete this and following materialized occurrences and stop the recurrence.
- Provide a separate Stop Recurrence action that cancels future generation while preserving every existing expense.
- Resolve exchange-rate conversions on each generated occurrence date while preserving fixed custom rates.
- Attribute generated expenses to the original series creator and dispatch recurring-specific notifications through the existing fire-and-forget notification system, including the creator as a recipient. A newly created schedule sends one recurrence-aware notification; when creation immediately catches up multiple due occurrences, that initial notification and the catch-up are combined into one summary.
- Record individual activities for every expense affected by recurring creation, this-and-future editing, and this-and-following deletion while coalescing multi-expense email/push delivery into one count-and-date-range summary. Standalone recurrence stopping also notifies affected participants, and delete-and-stop folds the stop result into the deletion summary.
- Add recurrence previews, series navigation, occurrence-versus-series mutation scopes, visible lifecycle badges, safe inline edit-scope context, and cache convergence for asynchronously materialized occurrences to the web UI.
- Fully migrate existing production recurrence chains and remove the legacy recurrence table after transactional validation.

## Capabilities

### New Capabilities

- `recurring-expense-series`: Recurrence cadence, termination, materialization, series editing, navigation, migration, and UI behavior.
- `background-jobs`: Generic PostgreSQL-backed job execution, retries, reconciliation, dead-letter handling, and worker operations.

### Modified Capabilities

- `expenses`: Recurring expense inputs, copy behavior, conversion handling, and scoped series mutations.
- `activities`: Original-creator attribution and a recurring-expense-created activity event.
- `activity-notifications`: Recurring-specific notification content and creator-inclusive recipient behavior without migrating delivery to the worker.
- `exports`: Interval-aware recurrence export and legacy-compatible import representation.

## Impact

- Adds pg-boss and a separately deployable worker application using the existing PostgreSQL database.
- Changes Prisma schema, migrations, expense API inputs/outputs, shared domain schemas, import/export formats, and recurrence UI.
- Adds explicit recurring delete modes, Stop Recurrence mutation behavior, terminal-series editing rules, lifecycle-aware badges, and responsive action affordances to expense view and edit surfaces.
- Removes request-time recurrence writes and the legacy `RecurringExpenseLink` storage model.
- Requires a write-maintenance production migration with validation before API and worker startup.
