## Why

Recurring expenses are currently materialized as a side effect of reading group expenses, so creation is neither timely nor durable and concurrent reads can race. Spliit also needs a reusable background-work foundation for future asynchronous features, making this the right point to replace the legacy recurrence chain with an explicit series model and a PostgreSQL-backed worker.

## What Changes

- Add a pg-boss worker service with scheduled execution, retries, dead-letter handling, reconciliation, and operator visibility.
- **BREAKING** Replace `Expense.recurrenceRule` and `RecurringExpenseLink` with an authoritative recurrence-series model linked to ordered expense occurrences.
- Support repeat intervals of 1–99 days, weeks, months, or years, with indefinite, total-count, or inclusive end-date termination.
- Materialize all due past occurrences, schedule future occurrences from the entered expense date, and prevent duplicate creation under retries or concurrent workers.
- Resolve exchange-rate conversions on each generated occurrence date while preserving fixed custom rates.
- Attribute generated expenses to the original series creator and dispatch recurring-specific notifications through the existing fire-and-forget notification system, including the creator as a recipient.
- Add recurrence previews, series navigation, and occurrence-versus-series mutation scopes to the web UI.
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
- Removes request-time recurrence writes and the legacy `RecurringExpenseLink` storage model.
- Requires a write-maintenance production migration with validation before API and worker startup.
