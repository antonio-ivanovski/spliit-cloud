## Context

The legacy recurrence implementation stores one `RecurringExpenseLink` per expense and materializes due rows from `getGroupExpenses()`. It has no series identity, interval, termination, durable retry state, or concurrency-safe idempotency. Notifications already have a fire-and-forget activity dispatcher, and server-authoritative currency conversion already supports historical rate lookup. Production contains live recurrence chains that must be preserved.

## Goals / Non-Goals

**Goals:**

- Make PostgreSQL recurrence-series rows the authoritative business state and pg-boss the horizontally scalable execution layer.
- Support intervals, yearly cadence, anchored calendar math, past catch-up, future scheduling, scoped mutations, navigation, creator attribution, and date-aware exchange conversion.
- Fully migrate and remove the legacy recurrence table in one validated maintenance operation.
- Establish a generic worker/job registry usable by later asynchronous features.

**Non-Goals:**

- Migrating activity notification delivery into pg-boss.
- User-configurable execution time or timezone.
- Frequencies other than day, week, month, and year.

## Decisions

### PostgreSQL domain state plus pg-boss execution

`RecurringExpenseSeries` stores cadence, anchor, next date, termination, creator, occurrence count, status, and a typed JSON template. `Expense` stores nullable series ID and sequence with a unique composite constraint. pg-boss stores scheduled attempts, retry, and DLQ state. This keeps product reads and recovery independent of queue retention while allowing multiple workers through PostgreSQL locking. A periodic reconciliation job re-enqueues due series so deleted/missing queue rows do not lose work.

Alternatives rejected: BullMQ adds Redis operations; a bespoke jobs table duplicates pg-boss; queue-only series state cannot safely support edits, navigation, exports, or durable recovery.

### One materialization transaction per occurrence

Each job locks the series, validates expected sequence/date, resolves conversion, creates the expense and activity, advances the series, and sends the next pg-boss job using the same transaction-bound adapter. `(seriesId, sequence)` is the durable idempotency boundary. Catch-up is a chain of immediately available jobs rather than one unbounded transaction.

### Anchored interval calculation

New and reconfigured schedules calculate occurrence dates from the anchor and ordinal, not from the prior clamped date. Missing month/year days clamp only that occurrence. Legacy schedules preserve their existing open expense as anchor and exact stored next date so migration does not silently move production schedules.

### Typed template in entered-currency units

The series template stores original input amount, splits/items in their existing input units, and conversion intent. CUSTOM retains its fixed rate; EXCHANGE calls the existing resolver with the occurrence date. Attachments are omitted because they belong to a particular receipt.

### Existing notification dispatcher remains

Generated rows record `RECURRING_EXPENSE_CREATED` and immediately schedule the existing dispatcher after commit. Recurring creation is a distinct notification preference category so users can configure its channels independently. The recurring-only path includes the original creator while ordinary activity continues excluding its actor.

### Legacy Spliit import stays immutable

The Spliit importer remains a compatibility boundary for exports from the original `spliit.app`. Its JSON and CSV wire schemas are unchanged. Legacy recurrence fields are mapped into new internal series during import; current Cloud series identifiers, sequence numbers, templates, and status are never added to the transport.

### Official private operations dashboard

The worker exposes only liveness and readiness endpoints. The production compose stacks do not build or deploy a dashboard; the operator hosts the official `@pg-boss/dashboard` package as a separate Dokploy app, with private access (normally Basic Auth plus an SSH tunnel). Local development compose starts the pinned upstream package directly in a Node 24 container for convenience. Product recurrence state remains authoritative in application tables; the dashboard is operational tooling only.

### Maintenance-window replacement migration

The migration creates and backfills the new schema, validates every open link and sequence, and only then drops `RecurringExpenseLink` and `Expense.recurrenceRule`. Any invariant failure aborts the transaction. No dual-read or dead compatibility model remains.

## Risks / Trade-offs

- [pg-boss Bun compatibility] → Add a runtime smoke/integration test; use a Node 22 worker image if the pinned Bun runtime is incompatible.
- [External FX outage blocks an occurrence] → Propagate the failure to retry/DLQ without partial expense creation.
- [Large historical catch-up] → Process one occurrence per job/transaction and let worker concurrency/backpressure control load.
- [Ambiguous legacy timestamp chains] → Preserve each open leaf as an active standalone series, emit migration diagnostics, and never drop an open schedule.
- [Creator unavailable in legacy activity] → Store a nullable creator and use SYSTEM attribution without guessing another user.
- [Fire-and-forget notification loss] → Accepted for this change; durable notification work remains separate.

## Migration Plan

1. Stop application writes and take a verified database backup.
2. Apply the transactional Prisma migration that creates, backfills, validates, and removes the legacy schema.
3. Regenerate Prisma, deploy API and worker together, and let reconciliation enqueue each active series's next job.
4. Run validation/reconciliation and inspect migration diagnostics before restoring writes.
5. Roll back by restoring the backup if the migration transaction or post-migration validation fails; do not attempt a lossy reverse migration.

## Open Questions

None.
