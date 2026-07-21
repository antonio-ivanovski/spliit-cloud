# Notification System Phase 2 — Durable Delivery Handoff

Status: planned; depends on Phase 1 Web Push and the existing activity dispatcher.

## Definition

Phase 2 makes notification delivery reliable across API restarts, deploys,
transient provider failures, and future horizontal scaling. The activity row
and intended per-recipient channel deliveries must survive independently of the
request process.

Out of scope: user-facing notification preferences, quiet hours, digests, and
an in-app inbox. Those belong to later phases.

## Proposal

Write an outbox/delivery record in the same Prisma transaction as the activity,
then process it from a separate worker. The worker claims deliveries with a
lease, sends through the existing email/push adapters, records success or
terminal failure, and retries transient failures with bounded exponential
backoff.

Use an idempotency key covering activity, recipient account, channel, and push
subscription where applicable. One activity may therefore produce multiple
recipient/channel rows without duplicate sends during retries. Expired push
subscriptions are removed after permanent provider responses.

The worker should be deployable as a separate Bun process/container while
sharing the API/domain/database packages. The API remains responsible for
creating intent; it does not wait for delivery.

## Implementation Notes

- Add delivery status, attempt count, next-attempt time, lease owner/time,
  provider error metadata, sent time, and a unique idempotency constraint.
- Capture the rendered notification input or a stable event reference plus
  enough copied metadata to render after the source expense is deleted.
- Add a claim loop with short leases, retry classification, jitter, and a
  graceful shutdown path.
- Add worker health/lag metrics and structured logs keyed by activity and
  delivery IDs.
- Keep the Phase 1 routing policy as the producer-facing policy; later
  preference resolution should only alter which rows are created.

## Risks / Open Decisions

- Choose in-process database polling versus an external queue based on expected
  volume and deployment limits.
- Define retention for successful and terminal delivery rows.
- Decide whether a permanently failed push delivery should create an email
  fallback row or only be surfaced operationally.

## Acceptance Criteria

- A committed activity always has durable delivery intent before the request
  returns.
- Restarting the API does not lose pending sends.
- Transient failures retry without duplicate successful delivery.
- Permanent push endpoints are pruned and delivery state is auditable.
- Worker lag, retry count, and terminal failures are observable.

## Suggested Sequence

1. Add schema/migration and transaction-scoped outbox creation.
2. Extract channel adapters behind a delivery interface.
3. Implement worker claim/retry/idempotency behavior.
4. Add deployment stage, health checks, metrics, and cleanup.
5. Run failure-injection and restart integration tests.
