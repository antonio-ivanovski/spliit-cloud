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

### Monotonic consumed sequence without tombstones

`RecurringExpenseSeries.occurrencesCreated` is the authoritative count of consumed schedule slots and only moves forward. A materialized occurrence is identified by its `(seriesId, sequence)` expense row while it exists; deleting that row does not decrement the counter and does not create a tombstone or a deleted placeholder. Sequence gaps are therefore expected and are not evidence that reconciliation should recreate an expense. Count termination includes deleted slots, and date termination continues to use the original anchored schedule; deletion never extends either limit.

Occurrence deletion removes one materialized row and leaves the series active. “Delete this and following” removes all currently materialized rows at or after the selected sequence but leaves the series active and continues from the next unconsumed sequence. Since unmaterialized dates have no rows, this operation cannot delete future schedule slots; choosing “delete this and following and stop recurrence” performs the same row deletion and marks the series `CANCELLED`, preventing all future materialization. All three operations are idempotent under retries.

Stop Recurrence is a separate permanent mutation. It locks the series, marks it `CANCELLED`, invalidates queued work, and preserves every materialized expense. A cancelled or completed series has no Stop Recurrence action; restarting requires a new recurrence or copy.

Cancelled and completed series remain historical collections whose existing materialized rows can still be maintained. Their action surface keeps occurrence-only and this-and-future edit/delete choices, but a scoped mutation must preserve the terminal status and must never resume generation. For terminal series, “this and future” means the selected and higher-sequence materialized rows only. `PAUSED` is an operational archive state and is presented as running in the simplified user-facing lifecycle badge.

### Anchored interval calculation

New and reconfigured schedules calculate occurrence dates from the anchor and ordinal, not from the prior clamped date. Missing month/year days clamp only that occurrence. Legacy schedules preserve their existing open expense as anchor and exact stored next date so migration does not silently move production schedules. Legacy migration orphan overdue skip and JSON import overdue skip use the same anchored ordinal math as materialization; they do not chain one-interval steps from the previous occurrence date.

### Typed template in entered-currency units

The series template stores original input amount, splits/items in their existing input units, and conversion intent. CUSTOM retains its fixed rate; EXCHANGE calls the existing resolver with the occurrence date. Attachments are omitted because they belong to a particular receipt.

### Individual activities with coalesced recurring delivery

Every created, edited, or deleted materialized expense records its own activity so the feed remains an accurate per-expense audit trail. Notification fan-out is separately coalesced: one affected expense uses normal recurring-aware content, while two or more expenses affected by one recurring operation produce one participant-scoped summary containing the count and scheduled date range. Eligible recipients are the union of active account-backed participants represented by the affected rows or series template, with the normal actor-exclusion rule except for generated recurring creation, which continues to include the original creator.

Creating a recurrence always uses the `RECURRING_EXPENSE_CREATED` preference category and content that explains the recurrence rule and termination. If occurrence one is the only occurrence due through the current UTC date, its recurring-specific notification is dispatched after commit. If the past anchor makes multiple occurrences immediately due, creation opens a persisted catch-up batch seeded with occurrence one, suppresses its standalone delivery, and emits one combined schedule-created/catch-up summary after the worker finishes the due range. The combined summary includes occurrence one, the total created count, date range, and recurrence rule; recipients do not receive a second schedule-created message.

Generated rows and bulk mutation rows retain individual activities even while their email/push delivery is suppressed. This-and-future edit and this-and-following delete use normal delivery for one affected row and one summary for multiple affected rows. A standalone Stop Recurrence operation records and dispatches a recurrence-stopped event through the existing deletion-style delivery path under `EXPENSE_CHANGED`, scoped to eligible participants in the series template and excluding the actor. Delete-and-stop emits no second stop notification: the single deletion notification or summary states that the schedule was also stopped.

Persisted batch state and stable event identifiers protect catch-up summaries from worker retries. Request-driven bulk edit/delete summaries derive a stable operation identifier from their committed activity set so the dispatcher is invoked once for the operation. Cancellation or reconfiguration clears any unrelated open catch-up batch without claiming ungenerated occurrences. Notification channel delivery remains governed by the existing fire-and-forget coordinator.

### Lifecycle-aware UI and cache convergence

Edit-scope context is rendered as a non-sticky inline status alert inside the page content immediately above the expense form, keeping it below the application header on mobile and desktop. Recurrence badges expose `Running`, `Stopped`, or `Completed` in both visible text and accessible labels; `PAUSED` maps to `Running`. The repeat icon is paired or composed with play, X, or check respectively, and color is supplementary rather than the only status signal.

Recurring actions are driven by authoritative series status. Active or paused series offer Stop Recurrence; cancelled or completed series do not. Terminal series keep occurrence-only and this-and-future edit/delete actions for already-materialized rows, and these mutations preserve terminal state.

Expense mutations invalidate every cached expense-list variant for the group, not only the empty-filter first page, as well as expense detail, series history, activities, balances, and other existing expense-derived queries. Past-dated recurrence creation is asynchronous, so its response exposes enough series progress to let the client temporarily poll while catch-up is pending. Completion or terminal failure stops polling and triggers one final broad invalidation. This bounded convergence mechanism covers navigation away and back without requiring a new real-time transport.

### Legacy Spliit import stays immutable

The Spliit importer remains a compatibility boundary for exports from the original `spliit.app`. Its JSON and CSV wire schemas are unchanged. Legacy `recurrenceRule` fields on JSON rows map into internal series during import; matching historical recurring rows collapse into one series with ordered sequences using the same fingerprint as migration orphan collapse. The import confirm step lists each collapsed schedule once (title and cadence). CSV imports remain non-recurring and the source step directs users to JSON for recurrence. Current Cloud series identifiers, sequence numbers, templates, and status are never added to the transport.

### Official private operations dashboard

The worker exposes only liveness and readiness endpoints. The production compose stacks do not build or deploy a dashboard; the operator hosts the official `@pg-boss/dashboard` package as a separate Dokploy app, with private access (normally Basic Auth plus an SSH tunnel). Local development compose starts the pinned upstream package directly in a Node 24 container for convenience. Product recurrence state remains authoritative in application tables; the dashboard is operational tooling only.

### Maintenance-window replacement migration

A single Prisma migration (`20260722120000_durable_recurring_expenses`) creates `RecurringExpenseSeries` (including `catchUpBatch`), backfills legacy link chains, collapses link-less recurring expenses by import fingerprint, validates invariants, and only then drops `RecurringExpenseLink` and `Expense.recurrenceRule`. Any invariant failure aborts the transaction. No dual-read or dead compatibility model remains. There is no separate post-migration repair step for orphan collapse.

Link reconstruction prefers the next expense whose `expenseDate` equals the prior link's `nextExpenseDate`, falling back to a unique `createdAt` match when legacy catch-up created several frames in one millisecond. Unresolved ambiguity aborts the migration.

Collapsed orphans advance `nextOccurrenceDate` past today using **anchored**
occurrence math (the same `anchor + (ordinal - 1) intervals` model as
materialization), not iterative next-from-previous stepping. That keeps
month-end and leap-day anchors materializable after overdue skip. Chain series
preserve open-leaf schedules; closed leaves without a terminal expense remain
schedulable instead of being marked `COMPLETED` when the latest row was deleted.

## Risks / Trade-offs

- [pg-boss Bun compatibility] → Add a runtime smoke/integration test; use a Node 22 worker image if the pinned Bun runtime is incompatible.
- [External FX outage blocks an occurrence] → Propagate the failure to retry/DLQ without partial expense creation.
- [Large historical catch-up] → Process one occurrence per job/transaction and let worker concurrency/backpressure control load.
- [Ambiguous legacy timestamp chains] → Abort the migration transaction after preflight surfaces unresolved edges; do not merge chains heuristically or drop open schedules.
- [Fragmented link-less recurring history] → Collapse orphans by the same fingerprint used at JSON import so stop recurrence and this-and-following delete operate on one `recurringSeriesId`.
- [Creator unavailable in legacy activity] → Store a nullable creator and use SYSTEM attribution without guessing another user.
- [Fire-and-forget notification loss] → Accepted for this change; durable notification work remains separate.

## Migration Plan

1. Stop application writes and take a verified database backup.
2. Apply the single transactional Prisma migration that creates, backfills link chains, collapses orphans, validates, and removes the legacy schema.
3. Regenerate Prisma, deploy API and worker together, and let reconciliation enqueue each active series's next job.
4. Run validation/reconciliation and inspect migration diagnostics before restoring writes.
5. Roll back by restoring the backup if the migration transaction or post-migration validation fails; do not attempt a lossy reverse migration.

## Open Questions

None.
