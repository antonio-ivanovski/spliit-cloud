## Why

Notification intent is currently handed to an in-process `queueMicrotask`, so a successful domain mutation can permanently lose its email or push notification when the API or worker restarts, a provider fails transiently, or the process is deployed. Spliit already has transaction-aware pg-boss infrastructure and a dedicated worker; this change makes delivery durable by committing recipient/channel intent with the activity and making that worker the only provider-facing dispatcher.

## What Changes

- Persist one immutable `NotificationDelivery` intent per resolved recipient and channel in the same database transaction as the activity and its domain mutation.
- Treat `NotificationDelivery` as both the transactional outbox and a bounded operational audit record; do not add a second outbox table or rely on short-lived pg-boss metadata as business state.
- Resolve eligibility, notification category, account preferences, channel selection, and push subscription identity exactly once while producing delivery rows. Retries use the captured intent and never re-resolve preferences or invent an Email fallback for failed/missing Push.
- Enqueue `notification.deliver` jobs transactionally through the existing pg-boss adapter, using the delivery ID as the job singleton key and the delivery uniqueness constraint as the final deduplication boundary.
- Reconcile due non-terminal delivery rows on worker startup and on a bounded schedule so explicit jobs-disabled maintenance windows or administratively removed pg-boss rows recover without losing intent.
- Make the worker the sole owner of email and push provider I/O. It conditionally claims one delivery, invokes a strict per-channel sender, records success or permanent failure, and rethrows transient failures so pg-boss performs bounded exponential-backoff retries and dead-lettering.
- Replace API and recurring-worker fire-and-forget dispatch calls with a single producer-side notification planning service that is transaction-aware and safe to call repeatedly.
- Refactor notification code into explicit planning and delivery boundaries: producers may build durable intent, while only worker-owned delivery code may render/send. Remove error swallowing below the worker retry boundary and remove process-global dispatcher registration from API startup.
- Preserve the existing account preference and optional-email unsubscribe contracts. Optional email is rendered with a fresh signed unsubscribe URL and RFC 8058 headers; one-click unsubscribe removes Email only and remains idempotent.
- Prune expired push subscriptions only for permanent endpoint responses such as HTTP 404/410. Record normalized provider error metadata without retaining secrets or full provider payloads.
- Add structured delivery logs and worker health statistics for oldest runnable queue age, missing-transport deliveries, retrying count, and terminal failures, plus explicit retention and cleanup for durable delivery rows.
- Delete successful delivery rows completely after a 24-hour deduplication/safety window and delete permanent or retry-exhausted failures after 30 days. Keep no permanent notification history or deduplication tombstones.
- Route all activity-backed notification producers, including recurring catch-up/bulk summaries and targeted invitation/friend events that already use notification categories, through the durable path. Mandatory authentication and transactional mail that does not use the activity notification coordinator remains outside this change.
- **BREAKING (internal):** remove the `queueMicrotask` scheduling contract and the catch-and-warn dispatcher semantics; notification-producing write paths must supply a Prisma transaction and await durable scheduling before returning.

## Capabilities

### New Capabilities

- `durable-notification-delivery`: Durable per-recipient/channel intent, immutable snapshots, state transitions, leases, idempotency, retry/permanent-failure behavior, provider cleanup, retention, and delivery observability.

### Modified Capabilities

- `activity-notifications`: Activity-backed notifications change from post-commit fire-and-forget dispatch to atomic durable planning while preserving existing recipient, category, preference, summary, and unsubscribe behavior.
- `background-jobs`: The worker gains the `notification.deliver` queue and becomes the exclusive notification dispatcher with typed payloads, bounded retry/backoff, dead-letter behavior, horizontal-safe claiming, and delivery health reporting.

## Impact

- Database: new `NotificationDelivery` model, delivery status/channel/error types, indexes and idempotency constraints, plus a retention cleanup path.
- Jobs: `packages/jobs` delivery/reconciliation/cleanup registry entries, provisioning, send options, singleton-key helpers, handler typing, and worker admin health data.
- API: all activity-notification call sites and transaction boundaries; the API pg-boss client is generalized beyond recurrence and provider dispatcher initialization is removed from API startup.
- Worker: new delivery handler and provider initialization; recurring materialization schedules durable intent instead of calling notification dispatch directly.
- Notification modules: coordinator policy is split into an intent planner and strict channel senders; provider errors become a typed retry classification instead of being swallowed.
- Tests and operations: transaction rollback, deduplication, lease recovery, restart/failure injection, provider classification, preference snapshot, unsubscribe, retention, metrics, and redrive coverage.
- External client APIs remain compatible; no new account preference UI or user-facing setting is introduced.
