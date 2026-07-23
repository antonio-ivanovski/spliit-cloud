# Notification System Phase 2 — Durable Delivery Handoff

Status: planned; depends on Phase 1 Web Push and the existing activity dispatcher.
Phase 3 account preferences and optional-email unsubscribe are already
implemented and are part of the delivery contract below.

## Definition

Phase 2 makes notification delivery reliable across API restarts, deploys,
transient provider failures, and future horizontal scaling. The activity row
and intended per-recipient channel deliveries must survive independently of the
request process.

Out of scope: quiet hours, digests, and an in-app inbox. Account-level
user-facing preferences are already implemented in Phase 3; this phase must
persist their resolved channel choices rather than add another preference
surface or policy.

## Architectural Decision: Schedule vs Dispatch

The API and the recurring-expense worker are **producers** — they schedule
notification work. The worker is the sole **dispatcher** — it claims and sends
notifications through email/push adapters.

Current problem: the worker's `materializeRecurringExpense` handler calls
`scheduleDefaultNotificationDispatch()` directly, cross-cutting notification
delivery into the API's in-process fire-and-forget path (`queueMicrotask`).
This means notifications from the worker share the same unreliable,
non-durable dispatch as the API, with no retry, no delivery tracking, and no
survival across process restarts.

Target state: all call sites (API procedures and worker handlers) enqueue a
notification job via pg-boss. The worker consumes the `notification.deliver`
queue and is the only process that touches email/push providers.

## Existing Infrastructure (reuse, do not rebuild)

The `@spliit/jobs` package (`packages/jobs/`) already provides:

- **pg-boss** with queue provisioning, DLQ, retry/backoff, singleton dedup.
- **`bossTransactionDb()`** for atomic enqueue inside a Prisma transaction.
- **`startApiBoss()`** — the API already runs a lightweight pg-boss client for
  enqueuing recurring-expense jobs; reuse for notification enqueue.
- **`registerHandlers()`** in the worker with polling, concurrency, and
  graceful shutdown.
- **Worker deployment** — Dockerfile stage (`FROM runner AS worker`), compose
  service, health endpoint on port 3003.
- **Queue registry** (`packages/jobs/src/registry.ts`) — single source of
  truth for queue names and Zod payload schemas.

The notification dispatchers themselves (email rendering, push sending,
preference resolution, unsubscribe links) already exist in
`apps/api/src/lib/notifications/`. The worker already calls
`initializeDefaultNotificationDispatchers()` at startup. These move behind the
new queue handler; the dispatch logic is reused, not rewritten.

## Proposal

Write an outbox/delivery record in the same Prisma transaction as the activity,
then enqueue a pg-boss job referencing it. The worker claims deliveries from
the `notification.deliver` queue, sends through the existing email/push
adapters, records success or terminal failure, and retries transient failures
with bounded exponential backoff (inherited from pg-boss retry policy).

Resolve each recipient with the existing Phase 3 category and account
preference policy before creating delivery rows. Create one durable row per
resolved channel and keep the resolved choice stable while a delivery is
retried; the worker must not silently recalculate preferences or turn a
missing Push target into Email.

The protected `notifications.preferences.get` and
`notifications.preferences.save` procedures are the account-facing contract.
The save operation accepts only the supplied categories in one transaction;
`null` removes an override and omitted categories remain unchanged.

Use an idempotency key covering activity, recipient account, channel, and push
subscription where applicable. One activity may therefore produce multiple
recipient/channel rows without duplicate sends during retries. Expired push
subscriptions are removed after permanent provider responses. The pg-boss
singleton key provides job-level dedup; the delivery row unique constraint
provides row-level dedup.

The worker is already deployable as a separate Bun process/container sharing
the API/domain/database packages. The API remains responsible for creating
intent; it does not wait for delivery. The recurring-expense worker handler
must also enqueue rather than dispatch directly.

## Implementation Notes

- Add a `NotificationDelivery` model: status, attempt count, next-attempt
  time, lease owner/time, provider error metadata, sent time, and a unique
  idempotency constraint (activity + account + channel + subscription).
- Capture the rendered notification input or a stable event reference plus
  enough copied metadata to render after the source expense is deleted.
- Add `notification.deliver` to the queue registry
  (`packages/jobs/src/registry.ts`) with a Zod payload schema carrying the
  delivery row ID. Configure retry limit, backoff, and DLQ consistent with
  the existing materialization queue.
- Replace `scheduleNotificationDispatch()` (the `queueMicrotask` path) with a
  transactional enqueue: write delivery rows + `sendJob()` via
  `bossTransactionDb()` in the same Prisma transaction as the activity.
- Add a `notification.deliver` handler in `apps/worker/src/handlers.ts` that
  claims the delivery row (lease), calls the existing channel dispatchers,
  and records outcome. Reuse `initializeDefaultNotificationDispatchers()`
  already called at worker startup.
- Remove the direct `scheduleDefaultNotificationDispatch()` call from the
  recurring-expense materialization handler; it must enqueue via the same
  transactional path.
- Classify provider errors: transient (retry via pg-boss) vs permanent
  (mark terminal, prune expired push subscriptions on 404/410).
- Add worker health/lag metrics and structured logs keyed by activity and
  delivery IDs. The worker admin server (port 3003) already exists.
- Keep the shared notification category identifiers and account preference
  semantics as the producer-facing policy: explicit channels override the
  system default, `null`/reset removes the override, and omitted categories
  are preserved. Preference resolution should only alter which rows are
  created.
- Optional user-facing email rows must retain the Phase 3 unsubscribe
  contract: generate a signed URL at render/send time, include RFC 8058
  `List-Unsubscribe` headers, and make the exact one-click POST idempotently
  remove Email while preserving Push. Authentication, invitation, and other
  mandatory mail remain outside this contract.

## Risks / Open Decisions

- pg-boss polling (1s interval) is the transport; decide whether an outbox
  table is still needed for auditability or whether pg-boss job metadata +
  the `NotificationDelivery` row is sufficient.
- Define retention for successful and terminal delivery rows (pg-boss
  retention is 7d by default; delivery rows may need longer).
- Decide whether a permanently failed push delivery should create an email
  fallback row or only be surfaced operationally.
- Decide whether `scheduleTargetedNotificationDispatch()` (invitations,
  friend-added) also routes through the durable queue or remains fire-and-
  forget for now.

## Acceptance Criteria

- A committed activity always has durable delivery intent before the request
  returns.
- Restarting the API or worker does not lose pending sends.
- Transient failures retry without duplicate successful delivery.
- Permanent push endpoints are pruned and delivery state is auditable.
- Worker lag, retry count, and terminal failures are observable.
- The recurring-expense worker no longer dispatches notifications directly.

## Suggested Sequence

1. Add `NotificationDelivery` schema/migration and the `notification.deliver`
   queue to the registry.
2. Replace `scheduleNotificationDispatch()` with transactional outbox +
   enqueue; update all API call sites.
3. Update the recurring-expense materialization handler to enqueue instead of
   dispatching directly.
4. Implement the worker handler: claim, dispatch via existing channel
   dispatchers, record outcome, classify errors.
5. Add metrics, structured logging, and delivery-row cleanup/retention.
6. Run failure-injection and restart integration tests.
