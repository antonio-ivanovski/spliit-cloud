## Context

Spliit currently has the right pieces but the wrong execution boundary. Domain mutations persist an `Activity`, return from their Prisma transaction, and call `scheduleDefaultNotificationDispatch()`. That helper defers an `ActivityNotificationCoordinator` through `queueMicrotask`; the coordinator then reloads recipients, resolves current preferences, fans out to email/push dispatchers, and catches/logs provider failures. The recurring-expense worker calls the same helper after materialization, so even work that begins durably in pg-boss becomes best-effort at its final delivery step.

This creates four correctness gaps:

1. Activity and delivery intent are not atomic. A process can stop after commit but before the microtask runs.
2. Provider failures never reach pg-boss because the scheduler, coordinator, and channel dispatchers deliberately swallow errors.
3. Retries would not be stable if they reused the coordinator: it re-resolves preferences, memberships, source rows, and push targets on every call.
4. The worker is not the exclusive dispatcher; API processes initialize provider dispatchers and can perform provider I/O.

The repository already has a typed pg-boss registry, transaction-bound enqueue through `bossTransactionDb()`, API and worker boss lifecycles, retry/backoff, DLQs, structured worker logging, and a worker admin server. Phase 1/3 notification code already provides recipient handlers, category mapping, preference resolution, email/push rendering, push endpoint pruning, and optional-email unsubscribe support. The design deliberately refactors and reuses those pieces instead of adding another queue library, preferences model, or provider framework.

`NotificationDelivery` is temporary operational state, not merely queue metadata and not permanent user history. While work is pending/retrying and during the short terminal safety window, the row is authoritative for what Spliit intended, which target/channel was chosen, and what happened. Cleanup removes the entire row when that operational purpose ends.

## Goals / Non-Goals

**Goals:**

- Commit notification intent atomically with its activity and domain mutation.
- Make the worker the only process that calls optional-notification email and push providers.
- Resolve recipients, categories, account preferences, channels, and concrete push subscriptions once and keep the result immutable across retries.
- Survive API/worker restart, transient provider errors, duplicate jobs, stale leases, and horizontal worker concurrency.
- Preserve enough versioned render input to deliver after the source expense, invitation, comment, member, or recurring batch state is changed or deleted.
- Reuse existing category, recipient eligibility, template, unsubscribe, and channel behavior without allowing those components to swallow durable-delivery errors.
- Keep the design lean: one business outbox table, the existing pg-boss transport, one planning boundary, and one strict delivery boundary.
- Make pending age, retry state, permanent failure, and exhausted delivery visible to operators.

**Non-Goals:**

- Exactly-once effects at external providers that do not support idempotent sends.
- Quiet hours, digests, an in-app inbox, notification history UI, or another preference surface.
- Automatic Email fallback when Push is absent or permanently fails.
- Moving mandatory authentication, verification, password, or invitation mail that does not use the activity notification coordinator.
- A generic workflow engine or a second queue/outbox abstraction.
- A large package split or rename of the API application layer. The worker already consumes shared backend application services from `@spliit/api`; this change narrows those exports instead of creating thin `mail`, `notifications`, and `application` packages with circular or cosmetic boundaries.

## Decisions

### 1. `NotificationDelivery` is the transactional outbox and audit record

Add one row for every resolved recipient/channel target. The row is created before the producer transaction commits and remains the source of truth only until its terminal cleanup deadline.

Use code-defined, Zod-validated strings for `status`, `channel`, and `category`, consistent with the generic `Activity` model, rather than adding PostgreSQL enums. Use a typed/versioned Prisma JSON snapshot so persistence boundaries remain compile-time and runtime validated.

The model should contain:

- `id`
- `eventKey`: stable identity for either a real activity or a synthetic summary/targeted event
- nullable indexed `activityId` relation with `onDelete: SetNull`
- indexed `recipientAccountId` relation with `onDelete: Cascade`, because account erasure cancels optional pending work and removes retained recipient data
- `category`, `channel`, and non-null `targetKey`
- nullable `pushSubscriptionId` for Push, with the original subscription ID retained in `targetKey`
- `status`
- `snapshotVersion` and typed `snapshot`
- `attemptCount` and `lastAttemptAt`
- unique per-claim `leaseToken`, tracing-only `leaseJobId`, and `leaseExpiresAt`
- normalized `lastErrorKind`, `lastErrorCode`, `lastProviderStatus`, truncated `lastErrorMessage`, `lastErrorAt`
- `sentAt`, `terminalAt`, `createdAt`, and `updatedAt`

The status machine is intentionally small:

```text
PENDING -> PROCESSING -> SENT
                    \-> PERMANENT_FAILURE
                    \-> PENDING (transient retry)
                    \-> RETRY_EXHAUSTED
```

`PROCESSING` is a renewable/recoverable lease, not a terminal state. Pending and expired-processing rows are deliverable. `SENT`, `PERMANENT_FAILURE`, and `RETRY_EXHAUSTED` are terminal.

Do not add a separate `NotificationOutbox` table. A second table would require another state machine and reconciliation between two representations of the same intent without adding a user-visible capability. pg-boss remains transport; `NotificationDelivery` remains business state.

Alternative considered: store only `activityId` and reconstruct at send time. Rejected because expenses and other source state can be deleted or changed, synthetic summaries need not have an Activity row, and a retry would observe different preferences/recipients/content.

### 2. Use a non-null target discriminator for idempotency

Create a unique constraint over `(eventKey, recipientAccountId, channel, targetKey)`.

- Email uses `targetKey = "account:<accountId>"`, yielding at most one Email delivery for an event/account.
- Push uses `targetKey = "push:<pushSubscriptionId>"`, yielding one delivery per subscription.

Do not use a nullable `pushSubscriptionId` directly in the unique constraint: PostgreSQL permits multiple `NULL` values in a unique composite constraint and would allow duplicate Email rows. Do not key only by activity because synthetic summaries/targeted events may not have an Activity row and one event legitimately fans out to many targets.

Producer upsert/create-many conflict handling plus this database constraint is the durable deduplication boundary while the delivery metadata is retained. The pg-boss singleton key is the delivery ID and prevents routine duplicate queue rows, but correctness must not depend on queue metadata. After bounded retention deletes that key, replay suppression for the historical event ends; retaining personal target identifiers forever solely for deduplication is not justified.

### 3. Split notification planning from notification delivery

Replace the broad fire-and-forget `ActivityNotificationDispatcher` role with two explicit application boundaries:

- **Planning:** accepts a normalized notification event plus a Prisma transaction, builds recipient intents using existing handlers, resolves category/preferences/channels, selects concrete push subscriptions, builds immutable snapshots, creates delivery rows, and transactionally enqueues one job per row.
- **Delivery:** accepts exactly one claimed delivery row, selects exactly one channel sender, renders from the persisted snapshot, performs one provider call, and returns success or throws a classified error.

The planner must receive a transaction-scoped database client. Recipient handlers and preference policy must be refactored to use that client rather than the global Prisma singleton so the activity, membership/preference view, delivery rows, and pg-boss sends share one consistent commit boundary.

All notification-producing mutation modules call one orchestration helper instead of importing scheduler, coordinator, or channel adapters. The helper may be named `planActivityNotificationDeliveries`; its name must communicate persistence, not execution. The existing `scheduleActivityNotification()` and `scheduleDefaultNotificationDispatch()` names should be removed after migration because they imply best-effort post-commit work.

The API must not initialize provider dispatchers. Worker startup initializes strict channel senders and registers the delivery handler. The queue registry in `@spliit/jobs` remains transport-only and must not import Prisma, API, rendering, or provider code.

The existing worker already imports backend business services from `@spliit/api` for recurring materialization. A narrow exported planning/delivery application module is acceptable in this change; creating several new workspace packages solely to hide that existing dependency would increase surface area without changing ownership. A future backend package extraction should move recurrence and notifications together, not split this feature prematurely.

### 4. Snapshot the delivery contract, not arbitrary database rows

Persist a discriminated, versioned snapshot containing only data required to render/send:

- stable event type/key, category, occurrence time, and template/content variant
- actor and subject display data
- group/direct-ledger display and link data
- event-specific amount/date/change/summary/recurrence/comment fields
- recipient account ID and copied display name; Email remains a logical account target and the current deliverable account address is loaded immediately before send
- optional-email unsubscribe category/account inputs
- for Push, copied title/body/link/tag/icon parameters and the selected subscription ID

Do not copy push endpoint, `p256dh`, or auth secrets into the snapshot. The worker fetches the exact `PushSubscription` row by captured ID immediately before Push send. If that row no longer exists, the delivery ends as a permanent `TARGET_GONE`; it does not select a newer subscription or create Email fallback.

Email intentionally targets the captured account rather than copying an address into the snapshot. Immediately before provider I/O, the worker loads that account's current address and verifies it is deliverable and not a placeholder. An address change therefore updates where the account's already-committed Email channel is delivered without changing its channel preference; a deleted account removes its optional pending/retained deliveries through the cascade. Ordinary preference changes do not rewrite existing rows.

Snapshots must never include provider credentials, unsubscribe signing secrets, raw exception objects, or full provider responses. Optional-email unsubscribe URLs and RFC 8058 headers are generated at render/send time from the captured account/category contract so tokens are fresh and secrets are not persisted.

Alternative considered: persist fully rendered HTML. Rejected because it duplicates large content per target, makes template/security fixes impossible before send, and encourages persisting signed URLs. Compact versioned render parameters preserve historical meaning without storing executable markup.

### 5. Enqueue in the same Prisma transaction

The API obtains the lightweight boss client before opening an interactive transaction. Inside that transaction it:

1. performs the domain mutation and writes the Activity;
2. invokes the planner with the same `Prisma.TransactionClient`;
3. creates/upserts delivery rows;
4. calls `sendJob(..., { singletonKey: delivery.id, db: bossTransactionDb(tx) })` for each newly created delivery.

If planning, row creation, payload validation, or pg-boss enqueue fails, the entire transaction rolls back. A successful response therefore never represents an activity whose expected delivery intent was lost.

The recurring materialization handler must move planning into `materializeRecurringExpense`'s existing transaction, alongside expense/activity creation, series advancement, and next-occurrence enqueue. The outer worker handler must not schedule notifications from the returned result. Catch-up summaries must be planned in the transaction that atomically finalizes the persisted catch-up batch and stable summary event key; they must not be constructed as an uncommitted after-handler side effect.

When jobs are enabled, failure to initialize the API enqueue client or transactionally send the pg-boss row is a write-readiness failure and notification-producing mutations fail atomically. `JOBS_ENABLED=false` is the one explicit exception: producers still persist `PENDING` delivery intent in the mutation transaction but do not attempt a queue write. On the next enabled worker startup, and periodically thereafter, a bounded notification reconciliation job compares non-terminal delivery rows with pg-boss transport metadata and enqueues only rows that have no live or scheduled `notification.deliver` job. This preserves intent through deliberate maintenance/development pauses without bypassing pg-boss backoff or treating an unexpected enqueue outage as success. The API must never silently fall back to `queueMicrotask`. Tests inject a transaction-capable fake boss.

Alternative considered: always commit delivery rows and enqueue afterward with a poller. Rejected as the primary path because the repository already supports atomic pg-boss enqueue. Bounded reconciliation is a recovery path for explicit disabled mode and missing transport metadata, not a race in the normal enabled producer path.

### 6. The delivery ID is the unit of work

Add `notification.deliver` with payload `{ deliveryId }`, singleton key `deliveryId`, retry limit/backoff/DLQ consistent with existing jobs, and an expiration greater than the provider timeout plus persistence overhead. Add bounded `notification.reconcile` and `notification.cleanup` maintenance jobs with singleton schedules and no provider fan-out inside the maintenance transaction. Add each DLQ before its source queue during provisioning.

The worker handles one delivery per job:

1. conditionally change `PENDING` (or expired `PROCESSING`) to `PROCESSING`, generate a fresh cryptographically random `leaseToken`, record `leaseJobId = jobId` only for tracing, set a bounded lease expiry, and increment `attemptCount`;
2. if the row is already terminal, acknowledge without provider I/O;
3. if another unexpired lease owns it, acknowledge that duplicate transport job without charging the provider retry budget; the active owner completes normally, while scheduled reconciliation re-enqueues the row after an orphaned lease expires;
4. send through the strict channel adapter;
5. conditionally record `SENT` only when the same unique claim token still owns the lease.

On a transient provider/database error, persist normalized error data, return the row to `PENDING`, clear the lease, and throw so pg-boss retries. pg-boss is the sole retry-time authority; do not copy or predict its randomized `start_after` value in `NotificationDelivery`. Reconciliation and health must inspect pg-boss's actual non-terminal job state/`start_after` in bounded queries so a normal backoff-delayed row is neither re-enqueued nor reported overdue. On the final allowed attempt, mark `RETRY_EXHAUSTED` and throw once more so the job reaches the DLQ. The job handler context must expose retry attempt/limit metadata instead of inferring it from log strings.

Every provider call must have a hard timeout shorter than the application lease, and the lease must be shorter than pg-boss job expiry with enough margin to persist the outcome. This ordering prevents pg-boss from starting a retry while the prior provider request can still be running.

On a permanent error, mark `PERMANENT_FAILURE`, clear the lease, and return successfully because retry cannot help. Push HTTP 404/410 is permanent: conditionally delete that exact subscription ID and record `ENDPOINT_GONE`. Invalid payload/snapshot versions are permanent implementation/data failures and remain highly visible; authentication/rate-limit/network/5xx failures are transient unless provider documentation proves otherwise.

The delivery adapter must not catch-and-warn. Error logging belongs once at the worker boundary, with `deliveryId`, `eventKey`, `activityId`, `channel`, `attemptCount`, classification, and provider status. Recipient addresses, endpoints, keys, tokens, and rendered bodies must not be logged.

### 7. Promise database idempotency and at-least-once provider execution

During the bounded delivery metadata-retention window, duplicate producers, duplicate pg-boss jobs, or worker redelivery after a recorded success cannot create another row or provider call. A terminal-state check prevents already-`SENT` rows from sending again. Once cleanup deletes the idempotency row, replaying that historical event can create new intent; permanent suppression would require an indefinite event-target tombstone and conflicts with the chosen privacy boundary.

There is nevertheless an unavoidable crash window for SMTP/Web Push: the provider can accept a message and the worker can stop before recording `SENT`. Retrying the expired lease favors eventual delivery but may duplicate the provider effect. This design does not claim distributed exactly-once delivery where providers offer no idempotency API.

Use a deterministic RFC `Message-ID`/provider idempotency key derived from the delivery ID wherever the provider supports it. This reduces duplicates but is not the database correctness boundary. Operational documentation and tests must distinguish:

- once-per-retained-key creation of durable intent;
- at-most-one provider invocation after a retained terminal state;
- at-least-once execution across an unrecorded provider-success crash.

Choosing to leave stale `PROCESSING` rows untouched would avoid a duplicate but could permanently lose a send that never reached the provider, contradicting the durability goal.

### 8. Preserve policy and migrate all coordinator-owned producers

The existing notification category mapping, actor rules, active account-backed membership checks, category-family defaults, explicit per-category channel override, reset/omitted preference semantics, and optional-email unsubscribe behavior remain authoritative.

The planner resolves those rules exactly once. Explicit Push remains Push even if there is no target; no Email row is created as fallback. One Push row is created per concrete subscription that exists at planning time. A category resolved to `[]` creates no rows and therefore no job.

Migrate every current activity/default/targeted coordinator call site in the same change, including expenses, imports, category bulk changes, comments, participant/member/group/archive flows, invitations, friends, settlement expenses, recurring creation, recurring catch-up summaries, bulk recurring summaries, and recurrence stopping. Leaving `scheduleTargetedNotificationDispatch()` as a hidden fire-and-forget escape hatch would make reliability depend on which helper a feature happened to call.

Mandatory mail that bypasses the notification coordinator remains direct and is explicitly named/documented at its call site. It must not be disguised as a notification category merely to reuse this queue.

### 9. Keep no permanent notification history

Delivery snapshots contain personal display and event data, so they and their surrounding delivery rows must be removed as soon as their operational purpose ends.

- Delete the entire `SENT` row 24 hours after `sentAt`. This short window protects immediate job redelivery/idempotency races; it is not notification history.
- Delete the entire `PERMANENT_FAILURE` or `RETRY_EXHAUSTED` row 30 days after `terminalAt`, allowing bounded diagnosis or intentional redrive.
- Never age-delete `PENDING` or `PROCESSING` rows.
- Delete in bounded batches from an indexed terminal-status/terminal-time query.
- Keep no permanent tombstone, recipient/channel history, snapshot, or sanitized outcome row after cleanup.

Run cleanup as a worker-owned scheduled maintenance job using the existing job lifecycle, not from API requests. The 24-hour and 30-day cutoffs are centralized defaults. Account erasure deletes rows earlier regardless of retention.

pg-boss retention remains independent. Deleting queue metadata must not delete live non-terminal delivery intent; deleting an expired terminal delivery row is intentional.

### 10. Extend worker health without turning it into an admin product

Keep `/health/liveness` process-only. Extend readiness/operational output with aggregate delivery and transport data:

- oldest runnable `notification.deliver` job age based on pg-boss's actual state and `start_after`;
- count/oldest age of non-terminal delivery rows with no live or scheduled pg-boss transport job;
- counts for active leases, retrying jobs, permanent failures, and retry-exhausted rows;
- timestamp/result of the most recent cleanup check.

Readiness should fail when pg-boss is unavailable, runnable notification lag exceeds a conservative configured threshold, or transport-missing rows remain beyond reconciliation tolerance; normal jobs waiting for a future retry `start_after` are not overdue. Historical terminal failures alone should be reported but should not make the process permanently unready. Aggregates must use indexed bounded queries and must expose no recipient content.

Structured logs cover planned row counts, claim, success, transient retry, permanent failure, exhausted retry, stale-lease recovery, cleanup, and reconciliation/redrive. High-cardinality IDs belong in logs, not unbounded metric label dimensions.

## Risks / Trade-offs

- [Provider accepted a send before the worker crashed] → Retry stale leases for eventual delivery, use deterministic provider message/idempotency IDs where available, and document the remaining at-least-once crash window instead of promising impossible exactly-once provider effects.
- [A retry reuses the same pg-boss job ID] → Generate a new lease token on every claim and use the job ID for tracing only, so a suspended stale attempt cannot finalize a newer attempt.
- [Lease contention consumes delivery retries] → Acknowledge the duplicate transport job without changing attempt state; let the active owner finish or scheduled reconciliation recover after lease expiry.
- [Cleanup ends replay suppression] → State the 24-hour successful and 30-day failed idempotency windows explicitly and prefer removal over an indefinite personal-data tombstone.
- [Planning performs recipient/preference queries inside mutation transactions] → Reuse handler queries with a transaction-scoped client, select only required fields, batch preference/subscription reads, and keep all rendering/provider I/O outside the transaction.
- [Large fan-out creates many pg-boss sends in one transaction] → Create rows in bulk, enqueue only newly created IDs, and impose a documented per-event fan-out guard; Spliit group sizes make one job per target acceptable and give the cleanest retry isolation.
- [Snapshot schema changes while old rows are pending] → Store `snapshotVersion`, keep readers for supported versions through the maximum pending/retention window, and classify an unsupported version as an observable permanent failure.
- [Snapshot retains personal information] → Store minimal render parameters, never destination/provider secrets, delete successful rows after 24 hours and failed rows after 30 days, redact logs, and cascade account erasure.
- [Push subscription disappears or rotates after planning] → Target the captured subscription ID; mark missing/404/410 permanently failed and never retarget or fall back to Email.
- [Provider call outlives its delivery lease] → Enforce provider timeout < application lease < pg-boss expiry and test the configured ordering at startup.
- [API availability now depends on transactional enqueue] → Treat enqueue readiness as part of write readiness and fail the mutation atomically; never restore a lossy fallback.
- [Existing channel dispatchers swallow errors and query live state] → Split content/snapshot building from strict provider adapters and delete catch-and-warn behavior from the durable path before enabling the worker queue.
- [Mixed deployment versions process incompatible snapshots] → Use additive schema first, versioned payloads, worker backward-compatible readers, and a staged producer cutover.
- [A queue row is administratively deleted or jobs are explicitly disabled while its delivery remains pending] → Compare bounded non-terminal delivery pages with actual pg-boss live/scheduled metadata, enqueue only transport-missing rows on enabled startup/schedule, and provide operator-triggered redrive using the same singleton key.
- [Worker-to-API package dependency remains aesthetically imperfect] → Keep exports narrow and feature-oriented now; extract a shared backend application package only as a coordinated recurrence/notification refactor, not as unrelated packaging churn in the durability change.

## Migration Plan

1. Add code-defined delivery schemas/types and the additive `NotificationDelivery` table, indexes, relations, and typed JSON snapshot. Regenerate Prisma and deploy without producers writing rows.
2. Add/provision `notification.deliver`, its DLQ, bounded reconciliation, cleanup scheduling, retry metadata in handler context, and worker support for claims/state transitions while the queue remains empty.
3. Refactor existing notification handlers into transaction-scoped planning and snapshot builders; refactor channel implementations into strict single-target senders. Keep legacy scheduling temporarily available only behind tests during this step.
4. Deploy a worker that can process snapshot version 1 before enabling version 1 producers.
5. Migrate API producer transactions in bounded groups, then recurring materialization/finalization, then targeted invitation/friend paths. Verify each group writes delivery rows and pg-boss jobs atomically.
6. Remove API provider initialization, `queueMicrotask` scheduling, global mutable dispatcher registration, post-commit worker dispatch, and obsolete wait-for-microtask test helpers. Search the repository to prove no coordinator-owned producer bypass remains.
7. Enable health aggregates, alerts, retention cleanup, and operator redrive. Run failure-injection tests for rollback, restart, transient retry, permanent Push pruning, stale leases, duplicate jobs, and deleted source data.
8. After the longest old deployment is gone, remove compatibility readers only when no pending/retained row uses the old snapshot version.

Rollback is staged. Before producer cutover, the additive table/queues are harmless. After cutover, roll back application code only to a version that still understands and drains the same snapshot version; do not roll back to fire-and-forget while durable rows exist. If provider delivery must be paused, stop worker consumption while allowing producers to keep committing `PENDING` rows, then resume with the compatible worker.

## Open Questions

None. This design intentionally resolves the handoff choices as follows: the delivery row is the temporary outbox, terminal Push failures do not fall back to Email, all coordinator-owned targeted notifications migrate now, successful rows are deleted after 24 hours, failed rows after 30 days, no permanent history/tombstone remains, and provider execution is explicitly at-least-once across the post-provider/pre-database crash window.

## Review-Driven Refinements

The following decisions were made or tightened during implementation review:

### Event identity is a discriminated union

`ActivityNotificationEvent` uses a discriminated `EventIdentity` union: `{ activityId: string; customEventKey? } | { activityId: null; customEventKey: string }`. Synthetic events (no Activity row) must provide a `customEventKey`; the planner has a runtime guard rejecting blank event keys. This prevents unrelated synthetic deliveries from colliding on a shared `activity:` fallback key.

### SMTP timeout validates the cumulative three-phase budget

Nodemailer's `connectionTimeout`, `greetingTimeout`, and `socketTimeout` are independent phase limits. The startup assertion validates `SMTP_OPERATION_BUDGET_MS = PROVIDER_TIMEOUT_MS * 3 < DELIVERY_LEASE_MS < jobExpiry`, not a single phase against the lease.

### Reconciliation is cursor-paginated and scan-bounded

`reconcileMissingDeliveryJobs` tracks `scanned` (rows examined) separately from `reconciled` (jobs created) and stops after a fixed scan limit. The `notification.reconcile` payload carries an optional `cursor`; the worker handler enqueues a continuation job with `nextCursor` when more rows remain, so healthy rows cannot starve orphaned deliveries and no single run is unbounded.

### Friend creation is fully atomic with notification planning

The router normalizes the peer (email → accountId) exactly once before resolving pg-boss, then runs both `createFriendLedger(args, tx)` and `planActivityNotificationDeliveries` inside one `prisma.$transaction()`. A planning failure rolls back the group creation. Boss is resolved only for account-backed peers; email/link paths do not depend on queue availability. All lookup helpers inside `createFriendLedger` accept the transaction client so reads share the transaction connection.

### Deleted-expense snapshots preserve the captured date

The `expense_deleted` snapshot schema includes an optional `date` field populated from the activity data, so the email renderer can display the original expense date even after the source row is gone.

### Health readiness uses exact transport matching

Worker readiness queries pg-boss's `job` table using `start_after` (snake_case, pg-boss 12) and classifies both `created` and `retry` states by time: `start_after <= now()` is runnable/overdue, `start_after > now()` is future backoff. Missing transport is counted via `NOT EXISTS` on `NotificationDelivery.id = job.singleton_key` rather than subtracting totals. The `PGBOSS_SCHEMA` env var is validated as a lowercase PostgreSQL identifier before SQL interpolation. Health thresholds (`HEALTH_RUNNABLE_LAG_THRESHOLD_MS`, `HEALTH_MISSING_TRANSPORT_THRESHOLD`) are validated integers in the jobs env schema.
