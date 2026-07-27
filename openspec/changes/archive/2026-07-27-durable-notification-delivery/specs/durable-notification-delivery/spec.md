## ADDED Requirements

### Requirement: Transactional notification intent
The system SHALL persist every resolved notification delivery in the same database transaction as the activity and domain mutation that caused it. When jobs are enabled, it SHALL also enqueue each `notification.deliver` job in that transaction. A delivery-producing transaction MUST fail as a unit when enabled durable planning or enqueue fails and MUST NOT fall back to in-process fire-and-forget dispatch.

#### Scenario: Activity and intent commit together
- **WHEN** a notification-producing domain mutation commits while jobs are enabled
- **THEN** its Activity, all resolved `NotificationDelivery` rows, and their pg-boss jobs are committed before the mutation returns successfully

#### Scenario: Enqueue failure rolls back the mutation
- **WHEN** creating or transactionally enqueueing any required delivery fails
- **THEN** the domain mutation, Activity, delivery rows, and queue rows are all rolled back

#### Scenario: Provider failure is isolated from the domain mutation
- **WHEN** Email or Push delivery fails after the producer transaction committed
- **THEN** the committed domain mutation and Activity remain intact and the failure is handled through durable delivery state and retry policy

#### Scenario: No fire-and-forget fallback
- **WHEN** the API job client or transactional enqueue path is unavailable while durable notifications are enabled
- **THEN** the producer reports a write-readiness failure rather than scheduling provider work in the API process

#### Scenario: Jobs are explicitly disabled
- **WHEN** a notification-producing mutation commits while `JOBS_ENABLED=false`
- **THEN** it still commits its resolved delivery rows as `PENDING`, creates no queue job, and leaves them for enabled-worker reconciliation

### Requirement: One immutable delivery per resolved target
The system SHALL create one immutable delivery row per resolved event, recipient account, channel, and concrete channel target. Recipient eligibility, category, preferences, channel selection, and target selection MUST be resolved once during planning and MUST NOT be recalculated while that row is retried.

#### Scenario: Explicit channels are captured once
- **WHEN** an account's category preference resolves to Email and Push
- **THEN** planning creates one Email delivery and one Push delivery for each concrete selected push subscription

#### Scenario: Preference changes after planning
- **WHEN** an account changes or resets its category preference after delivery rows are committed
- **THEN** existing rows retain their captured channels while later events use the new preference

#### Scenario: No selected channel
- **WHEN** category policy resolves to an empty channel list
- **THEN** planning creates no delivery row and sends no job for that recipient

#### Scenario: Push has no target
- **WHEN** policy explicitly resolves to Push but the account has no push subscription at planning time
- **THEN** the system creates no Push target delivery and MUST NOT substitute Email

#### Scenario: Push target disappears
- **WHEN** a captured push subscription is deleted or replaced before its delivery executes
- **THEN** that delivery ends in permanent target failure and MUST NOT retarget another subscription or substitute Email

### Requirement: Delivery idempotency
The system SHALL enforce durable idempotency throughout the delivery metadata-retention window with a non-null target discriminator unique across event key, recipient account, channel, and target. The delivery ID SHALL be the pg-boss singleton key and the retained database uniqueness constraint SHALL remain authoritative.

#### Scenario: Producer is replayed
- **WHEN** the same event is planned repeatedly for the same account, channel, and target while its delivery metadata is retained
- **THEN** at most one `NotificationDelivery` row exists for that tuple

#### Scenario: Email idempotency with no subscription
- **WHEN** an Email delivery is planned repeatedly
- **THEN** its non-null account target key prevents the multiple-`NULL` uniqueness behavior from creating duplicate rows

#### Scenario: Multiple push subscriptions
- **WHEN** one recipient has two selected push subscriptions
- **THEN** each subscription receives its own uniquely keyed delivery row and independently retryable job

#### Scenario: Duplicate job after success
- **WHEN** the worker receives another job for a retained delivery already recorded as `SENT`
- **THEN** it acknowledges the job without invoking the provider again

#### Scenario: Idempotency retention expires
- **WHEN** terminal cleanup deletes delivery metadata after its configured retention window
- **THEN** permanent replay suppression for that historical event/target ends rather than retaining a personal-data tombstone indefinitely

### Requirement: Versioned immutable render snapshot
Each delivery SHALL contain a Zod-validated, versioned snapshot with sufficient copied data to render the selected content after mutable source rows change or disappear. The snapshot MUST contain only delivery inputs and MUST NOT contain provider credentials, push encryption secrets, signed unsubscribe URLs, full provider responses, or arbitrary exception objects.

#### Scenario: Source expense is deleted
- **WHEN** an expense is deleted after its notification delivery was planned but before it is sent
- **THEN** the worker renders the committed title, amount, date, actor, group, and event content from the snapshot

#### Scenario: Synthetic summary has no Activity row
- **WHEN** a recurring catch-up or bulk summary uses a stable synthetic event key
- **THEN** its delivery is fully renderable and idempotent without requiring an Activity foreign key

#### Scenario: Unsupported snapshot version
- **WHEN** a worker cannot parse a delivery's snapshot version
- **THEN** it marks the delivery permanently failed with a normalized data-contract error and does not call a provider

#### Scenario: Optional email is rendered
- **WHEN** the worker renders an optional category Email from a snapshot
- **THEN** it generates a fresh signed unsubscribe URL and RFC 8058 one-click headers at send time rather than storing them in the snapshot

### Requirement: Horizontally safe delivery state
The system SHALL use conditional state transitions and an expiring lease with a fresh unique token per claim so only one worker attempt can actively process a delivery while terminal rows remain inert. The pg-boss job ID SHALL be retained separately for tracing and MUST NOT serve as the lease-ownership token. Delivery states SHALL distinguish pending, processing, sent, permanent failure, and retry exhaustion.

#### Scenario: First worker claims pending delivery
- **WHEN** a worker handles a due `PENDING` delivery
- **THEN** it atomically changes the row to `PROCESSING`, generates a fresh claim token, records its job ID for tracing, sets a bounded lease expiry, and increments the attempt count before provider I/O

#### Scenario: Concurrent duplicate job
- **WHEN** another worker handles the same delivery while the first lease remains valid
- **THEN** the second worker does not call a provider or overwrite the active attempt, acknowledges only the duplicate transport job, and relies on the active owner or expired-lease reconciliation to continue the delivery

#### Scenario: Worker stops during processing
- **WHEN** a worker stops before recording a terminal result
- **THEN** the delivery becomes claimable after the lease expires and remains eligible for retry

#### Scenario: Lease owner records success
- **WHEN** the provider succeeds and the handling job still owns the lease
- **THEN** the worker records `SENT`, `sentAt`, and terminal time and clears lease/retry error fields

#### Scenario: Stale worker finishes late
- **WHEN** a worker attempts to record an outcome after losing its lease
- **THEN** its unique claim token no longer matches, its conditional update fails, and it does not overwrite the current owner's state even when both attempts share one pg-boss job ID

### Requirement: Classified failure and retry behavior
The worker SHALL classify delivery failures as transient or permanent. Transient failures SHALL use bounded exponential-backoff pg-boss retry and dead-lettering; permanent failures SHALL be recorded terminally without retry. Error metadata MUST be normalized, bounded, and free of recipient/provider secrets.

#### Scenario: Transient provider failure
- **WHEN** a provider returns a timeout, connection failure, rate limit, or retryable server failure
- **THEN** the worker records the failed attempt, returns the row to `PENDING`, clears its lease, and throws so pg-boss alone determines the retry time

#### Scenario: Retry budget is exhausted
- **WHEN** the final permitted transient attempt fails
- **THEN** the worker records `RETRY_EXHAUSTED` and terminal error metadata and the pg-boss job reaches the notification dead-letter queue

#### Scenario: Permanent push endpoint
- **WHEN** Web Push returns HTTP 404 or 410 for the captured subscription
- **THEN** the worker marks the delivery `PERMANENT_FAILURE`, conditionally removes that exact subscription, and completes the job without retry

#### Scenario: Permanent target validation failure
- **WHEN** a captured target no longer exists or is permanently invalid
- **THEN** the worker records a terminal target error without selecting a replacement channel or target

#### Scenario: Error is logged safely
- **WHEN** any delivery attempt fails
- **THEN** structured output includes delivery/event/activity IDs, channel, attempt, classification, and bounded provider status while excluding addresses, endpoints, keys, tokens, and rendered bodies

#### Scenario: Provider timeout ordering
- **WHEN** the worker initializes strict channel senders
- **THEN** each provider timeout is shorter than the delivery lease and the lease is shorter than pg-boss job expiry

### Requirement: Provider delivery guarantee
The system SHALL create durable intent once per retained event/account/channel/target key and SHALL prevent provider invocation after a retained recorded terminal state. Provider execution across a crash after provider acceptance but before recording `SENT` SHALL be treated as at-least-once, with deterministic provider message or idempotency identifiers used where supported.

#### Scenario: Recorded success is redelivered
- **WHEN** pg-boss redelivers a job after `SENT` was committed
- **THEN** the terminal-state check prevents another provider invocation

#### Scenario: Provider acceptance is not recorded
- **WHEN** the provider accepts a send and the worker stops before `SENT` is committed
- **THEN** the expired lease is retried to favor eventual delivery even though a provider-level duplicate remains possible

#### Scenario: Provider supports idempotency
- **WHEN** the selected provider accepts a message ID or idempotency key
- **THEN** the sender derives a deterministic value from the delivery ID for every attempt

### Requirement: Delivery retention and privacy
The system SHALL keep no permanent notification history or deduplication tombstone. It SHALL delete entire terminal delivery rows in bounded batches after a short operational window and SHALL never age-delete non-terminal work. Successful rows SHALL be retained for 24 hours after `sentAt`; permanent and retry-exhausted failures SHALL be retained for 30 days after `terminalAt`.

#### Scenario: Successful retention expires
- **WHEN** a `SENT` delivery has been terminal for more than 24 hours
- **THEN** scheduled cleanup deletes the complete row, including snapshot and outcome metadata

#### Scenario: Failed retention expires
- **WHEN** a `PERMANENT_FAILURE` or `RETRY_EXHAUSTED` delivery has been terminal for more than 30 days
- **THEN** scheduled cleanup deletes the complete row, including snapshot and outcome metadata

#### Scenario: Pending row is old
- **WHEN** a `PENDING` or `PROCESSING` delivery is older than a terminal retention cutoff
- **THEN** age-based cleanup does not delete it

#### Scenario: Account erasure occurs
- **WHEN** account-erasure policy requires earlier removal of retained delivery data
- **THEN** the account cascade deletes its optional pending and retained delivery data regardless of normal retention

#### Scenario: Cleanup completes
- **WHEN** a terminal row passes its status-specific cutoff and cleanup deletes it
- **THEN** the system retains no separate notification-history row or deduplication tombstone for that delivery

### Requirement: Durable delivery observability
The system SHALL expose indexed aggregate delivery/transport health and structured lifecycle logs without exposing notification contents or recipient targets. pg-boss job state and `start_after` SHALL be authoritative for runnable/backoff timing.

#### Scenario: Delivery backlog is healthy
- **WHEN** an operator reads worker delivery health
- **THEN** it reports oldest runnable queue age, transport-missing non-terminal count/age, and counts for active leases, retrying jobs, permanent failures, and retry-exhausted deliveries

#### Scenario: Lag exceeds readiness threshold
- **WHEN** the oldest runnable pg-boss delivery job exceeds the configured operational threshold or transport-missing intent remains beyond reconciliation tolerance
- **THEN** worker readiness becomes unhealthy and reports the aggregate lag without recipient data

#### Scenario: Retry is waiting for backoff
- **WHEN** a `PENDING` delivery has a non-terminal pg-boss job whose `start_after` is in the future
- **THEN** health does not report it as overdue and reconciliation does not enqueue another job

#### Scenario: Historical failure exists
- **WHEN** retained terminal failures exist but the queue and current lag are healthy
- **THEN** health reports their counts without making the worker permanently unready

#### Scenario: Lifecycle is traceable
- **WHEN** a delivery is planned, claimed, retried, sent, permanently failed, exhausted, lease-recovered, or cleaned up
- **THEN** a structured log records the transition using delivery and event identifiers
