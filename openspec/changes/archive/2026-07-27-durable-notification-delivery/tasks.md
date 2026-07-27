## 1. Delivery Contracts And Persistence

- [x] 1.1 Define code-owned Zod schemas and inferred types for delivery status, failure classification, channel target, snapshot version 1, and normalized provider error metadata in the shared domain layer.
- [x] 1.2 Add `NotificationDelivery` to Prisma with optional Activity `onDelete: SetNull`, required recipient Account `onDelete: Cascade`, immutable event/target identity, typed snapshot JSON, attempt/lease/error timestamps, terminal timestamps, and indexes for claims, health, retention, and event lookup.
- [x] 1.3 Enforce uniqueness on `(eventKey, recipientAccountId, channel, targetKey)` with non-null target keys for Email and Push; add type-level helpers that produce canonical target keys.
- [x] 1.4 Write the additive SQL migration, including indexes and constraints that Prisma cannot express cleanly, and verify it neither rewrites nor removes existing activity/preference/push data.
- [x] 1.5 Regenerate Prisma Client and add focused schema/type tests proving delivery string/JSON fields use shared inferred types rather than unvalidated raw shapes.

## 2. Notification Job Registry

- [x] 2.1 Add `notification.deliver`, bounded notification-reconciliation, and notification-cleanup payload schemas, names, source/DLQ constants, and dead-letter mappings to the single `@spliit/jobs` registry.
- [x] 2.2 Add notification send/queue options with bounded exponential backoff, provider-safe execution expiry, retention, notify policy, and delivery-ID singleton key handling.
- [x] 2.3 Update queue provisioning so notification DLQs exist before source queues and startup converges mutable options without changing an incompatible existing queue policy.
- [x] 2.4 Extend job handler context with pg-boss retry attempt/limit metadata needed to distinguish retryable attempts from exhaustion.
- [x] 2.5 Extend `@spliit/jobs` tests for payload rejection, queue provisioning order, send defaults, singleton deduplication, retry metadata, and source/DLQ lookup.

## 3. Transaction-Scoped Planning Boundary

- [x] 3.1 Introduce a `planActivityNotificationDeliveries` application boundary that accepts a normalized event, `Prisma.TransactionClient`, and transaction-capable boss client and returns the newly created delivery IDs.
- [x] 3.2 Refactor activity handlers and recipient resolution to accept the supplied transaction client and batch-load only the membership/account/preference/subscription fields required for planning.
- [x] 3.3 Refactor category/default/override policy into a pure plan result that resolves channels once, preserves empty/explicit Push behavior, and does not silently add Email.
- [x] 3.4 Expand Push channels into one planned target per concrete subscription and Email into one canonical account target, then deduplicate drafts before persistence.
- [x] 3.5 Persist drafts and, when jobs are enabled, enqueue only newly inserted delivery IDs through `sendJob(..., { db: bossTransactionDb(tx), singletonKey: deliveryId })` within the caller's transaction; explicit disabled mode leaves rows `PENDING`.
- [x] 3.6 Add planner unit tests for actor/eligibility rules, explicit/default/empty preferences, multiple push subscriptions, no Push target, replayed events, and duplicate target suppression.
- [x] 3.7 Add transaction tests proving a planning/enqueue error rolls back the domain row, Activity, delivery rows, and pg-boss rows together.

## 4. Versioned Delivery Snapshots

- [x] 4.1 Define snapshot version 1 discriminators for existing expense, recurring, import, comment, group/member/invitation/friend, settlement, and summary content variants.
- [x] 4.2 Split current notification handlers/content builders so producer-side builders capture compact render parameters without performing provider I/O.
- [x] 4.3 Capture stable actor/subject/group/link/amount/date/change/recurrence/recipient display inputs while keeping Email as an account-scoped target whose current deliverable address is loaded only at send time.
- [x] 4.4 Capture Push presentation data plus only the selected subscription ID; prove endpoint, `p256dh`, auth, signing secrets, signed unsubscribe URLs, and provider payloads are never serialized.
- [x] 4.5 Add parse/render fixture tests for every snapshot discriminator, invalid/unsupported versions, deleted-source rendering, and synthetic events with no Activity row.

## 5. Delivery Repository And State Machine

- [x] 5.1 Implement an atomic claim operation that transitions `PENDING` or expired `PROCESSING` rows to `PROCESSING`, generates a fresh unique claim token, records `jobId` separately for tracing, assigns lease expiry, and increments attempts.
- [x] 5.2 Make claims return an explicit result for acquired, terminal, active-other-lease, missing, and invalid-snapshot cases so the worker never guesses from nullable fields.
- [x] 5.3 Implement unique-claim-token-guarded transitions for `SENT`, transient return to `PENDING`, `PERMANENT_FAILURE`, and `RETRY_EXHAUSTED`.
- [x] 5.4 Normalize and truncate provider errors into safe kind/code/status/message fields while leaving retry scheduling exclusively to pg-boss.
- [x] 5.5 Add concurrency tests for two claims, duplicate jobs after terminal state, stale-lease recovery, same-job-ID retry claims, and a late stale token attempting to overwrite the current result.

## 6. Strict Single-Target Channel Senders

- [x] 6.1 Replace fan-out channel dispatch with strict single-delivery Email and Push sender interfaces that either succeed or throw a typed transient/permanent delivery error.
- [x] 6.2 Refactor existing Email templates/content routing to render snapshot version 1 and send only the captured recipient target without reloading recipients or preferences.
- [x] 6.3 Generate optional-email signed unsubscribe URLs and RFC 8058 headers at send time, including a deterministic Message-ID derived from the delivery ID.
- [x] 6.4 Refactor Push sending to load only the captured subscription ID immediately before send and use the persisted title/body/link/tag/icon snapshot.
- [x] 6.5 Classify Push 404/410 and missing captured subscriptions as permanent; classify network, timeout, rate-limit, and retryable 5xx failures as transient unless an adapter proves otherwise.
- [x] 6.6 Remove catch-and-warn behavior below the strict sender boundary and add sender tests for success, unsubscribe headers, missing target, 404/410, transient failures, snapshot validation, and redacted errors.
- [x] 6.7 Enforce and startup-validate provider timeout < delivery lease < pg-boss execution expiry so an expired job cannot overlap a still-running provider attempt.

## 7. Worker Delivery Handler

- [x] 7.1 Register `notification.deliver` in `apps/worker` and handle exactly one delivery ID through claim, strict sender invocation, and guarded outcome persistence.
- [x] 7.2 On transient failure, persist retry metadata, clear the lease, and rethrow; on the last attempt, record `RETRY_EXHAUSTED` and rethrow into the DLQ.
- [x] 7.3 On permanent Push endpoint failure, conditionally delete only the captured subscription ID, record `PERMANENT_FAILURE`, and complete without retry or Email fallback.
- [x] 7.4 Honor terminal/duplicate/active-lease claim results without provider I/O, acknowledge lease-contention duplicates without consuming provider retries, rely on expired-lease reconciliation for orphan recovery, and honor the pg-boss cancellation signal around provider work.
- [x] 7.5 Initialize strict provider senders only in worker startup and remove provider-dispatcher initialization from API startup.
- [x] 7.6 Add worker handler tests for success, duplicate success job, active duplicate lease, transient retry, exhausted retry/DLQ, permanent Push pruning, missing target, invalid snapshot, cancellation, and stale lease.

## 8. API Producer Migration

- [x] 8.1 Generalize the lazy API pg-boss lifecycle out of its recurrence-only module, expose explicit notification write-readiness, and preserve graceful shutdown.
- [x] 8.2 Change `logActivity` orchestration so activity-backed notification planning occurs inside the caller's Prisma transaction rather than through a post-commit scheduling helper.
- [x] 8.3 Migrate expense create/update/delete, stop-recurrence, category-bulk, comments, and import summary producers to the transactional planner.
- [x] 8.4 Migrate group, archive/force-settlement, member, participant, link/soft-removal, and settlement-expense producers to the transactional planner.
- [x] 8.5 Preserve no-notification/suppressed-notification branches without creating empty delivery artifacts, and verify account/category/actor behavior at each migrated producer.
- [-] 8.6 Add API tests proving successful mutations expose committed Activity/delivery/job state and enqueue failure prevents the entire mutation from committing.

## 9. Recurring Producer Migration

- [x] 9.1 Plan normal generated-occurrence delivery inside `materializeRecurringExpense`'s existing transaction with expense creation, Activity, series advancement, and next materialization job.
- [x] 9.2 Plan catch-up summary delivery inside the transaction that finalizes the persisted batch, using its stable synthetic event key and captured participant-scoped snapshot.
- [x] 9.3 Plan schedule-created, recurring bulk edit/delete, and recurrence-stopped summaries inside their owning transactions while preserving individual Activity rows and suppression rules.
- [x] 9.4 Remove returned post-commit dispatch metadata that is no longer required and remove both direct `scheduleDefaultNotificationDispatch()` calls from the outer worker materialization handler.
- [x] 9.5 Rewrite recurring worker/API tests to assert durable rows/jobs, summary idempotency, creator inclusion, rollback atomicity, and no direct coordinator/provider invocation.

## 10. Targeted Notification Migration

- [x] 10.1 Replace targeted invitation and friend scheduling with a transaction-aware targeted planner using the existing recipient account, category, stable event key, and typed snapshot.
- [x] 10.2 Audit invitation flows to distinguish coordinator-owned optional notifications from mandatory invitation/authentication mail and document the latter at direct call sites.
- [x] 10.3 Add tests proving targeted preferences are captured once, repeated event keys deduplicate, optional unsubscribe remains category-specific, and mandatory mail behavior is unchanged.

## 11. Remove The Legacy Dispatch Path

- [x] 11.1 Remove `queueMicrotask`/`setImmediate` notification scheduling, pending-dispatch test tracking, process-global mutable dispatcher registration, and obsolete composite fire-and-forget wrappers.
- [x] 11.2 Refactor or remove `ActivityNotificationCoordinator` so no durable path re-resolves recipients/preferences or catches channel errors; retain only reusable planning/content components with ownership-revealing names.
- [x] 11.3 Update exports and comments that still describe best-effort, future-durable, or Phase 4 behavior.
- [x] 11.4 Search all apps/packages for `scheduleDefaultNotificationDispatch`, `scheduleTargetedNotificationDispatch`, `scheduleNotificationDispatch`, `waitForScheduledNotificationDispatchesForTest`, and direct optional-notification provider calls; remove every coordinator-owned bypass.
- [x] 11.5 Add an architecture test or lintable import assertion proving the API cannot initialize optional-notification providers and mutation modules cannot import worker delivery adapters.

## 12. Retention, Health, Logs, And Redrive

- [x] 12.1 Implement bounded indexed cleanup that deletes complete `SENT` rows after 24 hours, deletes complete `PERMANENT_FAILURE`/`RETRY_EXHAUSTED` rows after 30 days, and excludes every non-terminal status.
- [x] 12.2 Schedule cleanup through the worker job lifecycle and record its most recent success/failure without running maintenance from API requests.
- [x] 12.3 Add bounded aggregate queries that combine delivery rows with pg-boss's actual non-terminal job state/`start_after` to report runnable lag, transport-missing intent, active leases, retrying jobs, permanent failure, and retry exhaustion without treating scheduled backoff as overdue.
- [x] 12.4 Extend worker readiness with pg-boss availability, configurable runnable-lag and transport-missing tolerances, keep liveness process-only, and ensure future-backoff jobs/historical terminal failures do not incorrectly fail readiness.
- [x] 12.5 Emit redacted structured logs for planning, claim, success, retry, permanent failure, exhaustion, stale-lease recovery, cleanup, and operator redrive keyed by delivery/event/activity IDs.
- [x] 12.6 Add bounded startup/scheduled reconciliation plus operator redrive that checks actual pg-boss metadata and enqueues only non-terminal deliveries with no live/scheduled job, using the same delivery-ID singleton key.
- [x] 12.7 Add tests for jobs-disabled persistence/recovery, future-backoff exclusion, missing-transport detection, 24-hour/30-day cleanup cutoffs and batching, complete terminal-row removal, absence of tombstones, old non-terminal preservation, readiness lag behavior, aggregate redaction, cleanup scheduling, and idempotent reconciliation/redrive.

## 13. Failure Injection And Integration Coverage

- [ ] 13.1 Add a database-backed integration test that commits an activity/delivery/job, restarts the worker boundary, and proves the pending delivery remains processable.
- [ ] 13.2 Inject transient provider failures followed by success and prove attempt/error/sent transitions, pg-boss-owned retry timing, and one durable row within the retention window.
- [ ] 13.3 Inject duplicate pg-boss delivery and concurrent worker execution and prove a recorded `SENT` row results in no additional provider invocation.
- [ ] 13.4 Inject source deletion and preference changes between planning and send and prove snapshot content/targets remain stable.
- [ ] 13.5 Inject a worker stop after provider acceptance but before `SENT`, verify stale-lease recovery, and document/assert the intentionally at-least-once provider window rather than an impossible exactly-once guarantee.
- [ ] 13.6 Verify optional one-click unsubscribe remains idempotent and removes Email while preserving Push for subsequent events.
- [ ] 13.7 Verify account erasure cascades through optional pending and retained delivery rows without affecting unrelated accounts.

## 14. Quality Gates And Rollout Review

- [x] 14.1 Run Prisma migration/generation checks and review the generated SQL, target-key uniqueness, Activity `SetNull`, Account cascade, and claim/retention indexes against PostgreSQL.
- [x] 14.2 Run focused Bun tests for domain notification types, `@spliit/jobs`, notification planning/senders, API producer modules, and `@spliit/worker`.
- [-] 14.3 Run database-backed API `createCaller` integration tests with the database only; do not start an API or other long-lived service from the test task.
- [x] 14.4 Run `bun check-types`, `bun lint`, `bun check-formatting`, and the repository's default `bun test` suite after focused failures are resolved.
- [x] 14.5 Review structured logs and health responses for recipient addresses, push endpoints/keys, tokens, rendered content, and unbounded provider errors; remove any sensitive output.
- [x] 14.6 Perform a repository-wide producer audit mapping every former default/targeted scheduling call site to an owning transaction and a durable delivery test.
- [x] 14.7 Document the staged deploy order (schema/queues, compatible worker, producers, legacy removal), pause/resume procedure, DLQ/redrive procedure, retention defaults, and the supported provider delivery guarantee.
- [-] 14.8 Conduct a final reviewer pass against every OpenSpec scenario and resolve correctness, privacy, concurrency, and rollback defects before marking the change implementation-ready.

## 15. Post-Review Remark Fixes (P1/P2)

- [x] 15.1 [P1] Friends router: persist `activityId: null` for the synthetic friend-ledger event (no real Activity row) and rely on `customEventKey` for deduplication; make `ActivityNotificationEvent.activityId` nullable so the planner never inserts a non-existent FK.
- [x] 15.2 [P1] Planner: when the source expense row is deleted, reconstruct the snapshot `expense` from the parsed activity data (`title`/`amount`/`currencyCode`) instead of an unnamed zero-value expense.
- [x] 15.3 [P1] Reconciliation: walk rows deterministically by ascending `id` with a cursor (bounded page limit) so healthy rows cannot starve orphaned deliveries; count a row as reconciled only when `sendJob` returns a job id.
- [x] 15.4 [P1] SMTP: raise `DELIVERY_LEASE_MS` to 120s, above the cumulative three-phase nodemailer timeout (90s) plus rendering/DB margin, so a slow-but-successful send cannot be reclaimed mid-flight.
- [x] 15.5 [P2] Email sender: use `snapshot.group.name` for group-scoped phrasing; stop reusing the recipient display name as the group name.
- [x] 15.6 [P2] Planner: select the snapshot kind from the effective `notificationCategory` (`FRIEND_ADDED`) before the activity type, so friend-ledger events render through the `friend_added` branch instead of `invitation`.
- [x] 15.7 [P2] Cleanup: bound every deletion to at most `CLEANUP_BATCH_SIZE` eligible ids (selected in deterministic order) then delete by id list, instead of an unbounded `deleteMany`.
- [x] 15.8 [P2] Unit tests: mock the shared boss module (and `planNotificationForActivity`/jobs) so `recurrence-materialize` and `groups/archive` unit tests no longer open a real pg-boss connection.

## 16. Post-Review Remark Fixes Round 2 (P1/P2)

- [x] 16.1 [P1] Friend creation atomicity: resolve the boss client before the transaction and run both `createFriendLedger(args, tx)` and `planActivityNotificationDeliveries` inside one `prisma.$transaction()`, so a planning failure rolls back the group creation and a retry does not see `existed: true`.
- [x] 16.2 [P2] Reconciliation bounded scan: track `scanned` (rows examined) separately from `reconciled` (jobs created) and stop after `RECONCILE_SCAN_LIMIT` examined rows; add an optional `cursor` to the `notification.reconcile` payload, pass it through the worker handler, and enqueue a continuation job with `nextCursor` when more rows remain.
- [x] 16.3 [P2] Archive unit tests: mock `resumeRecurringExpenseSeries` at the `recurrence-series` module boundary (via `vi.hoisted`) so the unarchive path no longer attempts a real PostgreSQL/pg-boss connection; assert the resume operation is invoked.
- [x] 16.4 [P2] Event identity: replace the flat `activityId: string | null` + optional `customEventKey` with a discriminated `EventIdentity` union (`{ activityId: string; customEventKey? } | { activityId: null; customEventKey: string }`), and add a planner runtime guard rejecting blank event keys. Narrow `planNotificationForActivity` overrides to `Partial<Omit<…, 'activityId'>>`.
- [x] 16.5 [P2] Deleted-expense snapshot date: add an optional `date` field to `expenseDeletedSnapshotSchema`, populate it from `parsed.date` in the planner, and pass `snapshot.date ?? null` to `renderExpenseActivityEmail()` instead of hardcoded `null`.
- [x] 16.6 [P2] SMTP timeout budget: define `SMTP_OPERATION_BUDGET_MS = PROVIDER_TIMEOUT_MS * 3` and validate the cumulative three-phase budget (not a single phase) against the lease in `assertDeliveryTimeoutOrdering`; update tests to assert the effective budget.

## 17. Post-Review Remark Fixes Round 3 (P1/P2)

- [x] 17.1 [P1] Friend peer normalization: resolve email → accountId exactly once in the router before resolving pg-boss; remove the duplicate `resolveAccountByEmail` re-resolution from `createFriendLedger` so the router's classification is authoritative and the durable planner is never skipped due to a race.
- [x] 17.2 [P2] Boss only for account-backed peers: resolve `getApiBoss()` only when `'accountId' in peer`; email and link paths no longer depend on queue availability.
- [x] 17.3 [P2] Transaction-consistent reads: all lookup helpers in `createFriendLedger` accept a `TxClient` parameter; `const client = tx ?? prisma` is used for every read so interactive transactions do not reserve extra pool connections.
- [x] 17.4 [P2] Lint: replace `require()` calls in `architecture.test.ts` with ES imports (`node:fs`, `node:path`).

## 18. Post-Review Remark Fixes Round 4 (P1/P2)

- [x] 18.1 [P1] Health SQL column names: replace `j.startafter` with `j.start_after` (pg-boss 12 snake_case).
- [x] 18.2 [P1] Missing transport via NOT EXISTS: replace the subtraction heuristic with an exact `NOT EXISTS` query matching `NotificationDelivery.id = pgboss.job.singleton_key` for non-terminal deliveries without a live transport job.
- [x] 18.3 [P2] Retry classification: both `created` and `retry` states with `start_after <= now()` are runnable/overdue; future backoff is `start_after > now()` for both states; `active` counts toward live transport only.
- [x] 18.4 [P2] Schema validation: `PGBOSS_SCHEMA` validated as a PostgreSQL identifier and normalized to lowercase via `.transform().pipe()` in the jobs env schema.
- [x] 18.5 [P2] Health thresholds in env: `HEALTH_RUNNABLE_LAG_THRESHOLD_MS` and `HEALTH_MISSING_TRANSPORT_THRESHOLD` added to the jobs env schema with `z.coerce.number().int()`; documented in `.env.example`.
- [x] 18.6 [P3] Lint warnings: removed unused `ActivityNotificationEvent` import, unused outer `activity` binding, trailing whitespace in JSDoc.
