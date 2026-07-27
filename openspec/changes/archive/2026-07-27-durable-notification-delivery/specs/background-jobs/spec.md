## ADDED Requirements

### Requirement: Notification delivery queue
The jobs registry SHALL define `notification.deliver` with a validated `{ deliveryId }` payload, delivery-ID singleton key, bounded exponential retry, execution expiry, retention, and a provisioned notification dead-letter queue. It SHALL also define bounded notification reconciliation and cleanup maintenance jobs. Registry and queue code MUST remain independent of API, Prisma models, rendering, and provider adapters.

#### Scenario: Delivery job is enqueued
- **WHEN** a producer creates a new delivery row
- **THEN** it sends a schema-valid `notification.deliver` job using that row ID as payload and singleton key

#### Scenario: Worker provisions queues
- **WHEN** the worker or API job client starts against a new database
- **THEN** the notification dead-letter queue is created before the source delivery queue and the desired mutable queue policy converges

#### Scenario: Payload is invalid
- **WHEN** a producer or worker supplies a missing or empty delivery ID
- **THEN** the shared Zod registry rejects it before business handling

#### Scenario: Retry metadata reaches the handler
- **WHEN** pg-boss invokes a notification delivery attempt
- **THEN** handler context exposes the job ID, cancellation signal, current retry attempt, and retry limit needed for state classification

### Requirement: Worker-exclusive provider dispatch
The worker SHALL be the only runtime that consumes `notification.deliver` and invokes optional-notification Email or Push providers. The recurring materialization job SHALL plan delivery inside its business transaction and MUST NOT directly invoke the notification coordinator or provider adapters afterward.

#### Scenario: API mutation completes
- **WHEN** an API producer commits notification jobs
- **THEN** the API returns without waiting for or performing provider I/O

#### Scenario: Recurring materialization completes
- **WHEN** the materialization handler creates an occurrence or finalizes a catch-up summary
- **THEN** its transaction contains durable delivery intent and the outer handler performs no fire-and-forget dispatch

#### Scenario: Worker restarts with pending jobs
- **WHEN** the worker stops and later restarts while delivery jobs are queued or retrying
- **THEN** pg-boss resumes handling them and terminal delivery checks prevent re-sending recorded successes

#### Scenario: Multiple worker replicas run
- **WHEN** two worker processes can receive duplicate work for the same delivery ID
- **THEN** pg-boss coordination plus the delivery-row lease permits at most one active provider attempt

### Requirement: Notification maintenance and operational health
The worker SHALL compare non-terminal delivery rows with pg-boss metadata on enabled startup and a singleton schedule, re-enqueue only rows with no live or scheduled delivery job, perform bounded terminal-row cleanup, and expose aggregate delivery/transport lag and failure state through its existing admin server. Liveness SHALL remain process-only; readiness SHALL include pg-boss availability, runnable queue lag, and transport-missing intent.

#### Scenario: Enabled worker starts after jobs-disabled mode
- **WHEN** an enabled worker starts with `PENDING` deliveries that have no pg-boss job
- **THEN** bounded reconciliation enqueues their delivery IDs using the normal singleton key

#### Scenario: Pending delivery is in pg-boss backoff
- **WHEN** a `PENDING` row has a non-terminal `notification.deliver` job with future `start_after`
- **THEN** reconciliation leaves it unchanged and health does not count it as runnable lag

#### Scenario: Cleanup runs
- **WHEN** the scheduled notification cleanup job executes
- **THEN** it deletes only terminal rows beyond their status-specific retention cutoff in bounded batches

#### Scenario: Worker is ready
- **WHEN** pg-boss is running, oldest runnable notification lag is within threshold, and no transport-missing intent exceeds reconciliation tolerance
- **THEN** readiness returns healthy with aggregate delivery counters

#### Scenario: Current delivery lag is excessive
- **WHEN** oldest runnable job lag exceeds the configured threshold or transport-missing intent remains past tolerance
- **THEN** readiness returns unhealthy without exposing recipient or content data

#### Scenario: Terminal failures are retained
- **WHEN** permanent or exhausted failures exist within retention but current processing is healthy
- **THEN** readiness reports their counts without failing solely because historical failures exist

#### Scenario: Operator redrives missing transport metadata
- **WHEN** a non-terminal delivery row remains due after its pg-boss job was administratively removed
- **THEN** scheduled or operator-triggered bounded reconciliation confirms no live/scheduled job exists and enqueues its delivery ID again using the same singleton and database idempotency boundaries

## MODIFIED Requirements

### Requirement: Catch-up notification batch coordination
The worker SHALL persist catch-up batch boundaries and use a stable summary event key so overdue recurring materialization remains bounded and repeated materialization cannot create duplicate delivery intent. Summary delivery SHALL be transactionally planned through `NotificationDelivery` and `notification.deliver`; it MUST NOT use the fire-and-forget coordinator.

#### Scenario: Catch-up window is opened
- **WHEN** materialization discovers at least two occurrences due through the current UTC date
- **THEN** one persisted batch is opened for that series and individual generated-occurrence deliveries are suppressed until the batch is finalized

#### Scenario: Creation seeds immediate catch-up
- **WHEN** a newly created past-dated series has more than one occurrence due through the current UTC date
- **THEN** the creation transaction persists an open batch that includes occurrence one before enqueueing later materialization jobs

#### Scenario: Catch-up batch finalizes once
- **WHEN** the series advances past the batch cutoff
- **THEN** the finalization transaction uses one stable summary event key to create durable per-target delivery rows and retries cannot create a second batch or duplicate intent

#### Scenario: Cancellation clears catch-up without invented delivery
- **WHEN** the series is cancelled or reconfigured before the batch cutoff
- **THEN** the persisted batch state is cleared without planning notifications for ungenerated occurrences
