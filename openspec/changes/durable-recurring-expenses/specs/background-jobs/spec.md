## ADDED Requirements

### Requirement: Durable recurring materialization
The worker SHALL execute recurring materialization through pg-boss with retries, dead-letter handling, and horizontally safe PostgreSQL locking.

#### Scenario: Retried job is idempotent
- **WHEN** the same series sequence is delivered more than once
- **THEN** at most one expense is created for that sequence

#### Scenario: Failed job is surfaced
- **WHEN** materialization exhausts its configured attempts
- **THEN** the job remains inspectable and redrivable by operators

### Requirement: Transactional schedule advancement
The worker SHALL create one occurrence, advance its series, and enqueue the next occurrence atomically.

#### Scenario: Transaction rollback
- **WHEN** any materialization or next-job operation fails
- **THEN** neither the expense nor the series advancement is committed

### Requirement: Due-series reconciliation
The worker SHALL periodically re-enqueue expected work for due active series.

#### Scenario: Missing queue job
- **WHEN** an active series is due but its expected pg-boss job is absent
- **THEN** reconciliation enqueues it and database idempotency prevents duplicates

#### Scenario: Deleted materialized occurrence is not recreated
- **WHEN** an expense row for a consumed sequence is deleted
- **THEN** reconciliation relies on the monotonic series progress, does not infer a missing occurrence from the row gap, and never recreates that sequence

#### Scenario: Cancelled series rejects stale work
- **WHEN** a queued or reconciled job targets a cancelled series
- **THEN** the worker acknowledges the job without creating an expense or advancing the series

### Requirement: Catch-up notification batch coordination
The worker SHALL persist catch-up batch boundaries and emit a stable summary event identifier so overdue recurring materialization remains bounded and repeated materialization cannot open duplicate batches. Channel delivery continues through the existing fire-and-forget notification coordinator.

#### Scenario: Catch-up window is opened
- **WHEN** materialization discovers at least two occurrences due through the current UTC date
- **THEN** one persisted batch is opened for that series and individual generated-occurrence deliveries are suppressed until the batch is finalized

#### Scenario: Creation seeds immediate catch-up
- **WHEN** a newly created past-dated series has more than one occurrence due through the current UTC date
- **THEN** the creation transaction persists an open batch that includes occurrence one before enqueueing later materialization jobs

#### Scenario: Catch-up batch finalizes once
- **WHEN** the series advances past the batch cutoff
- **THEN** one stable summary event is emitted for each eligible participant scope with completed count/date range and recurrence rule, and retries cannot open a second batch

#### Scenario: Catch-up batch is discarded on cancellation
- **WHEN** the series is cancelled or reconfigured before the batch cutoff
- **THEN** the persisted batch state is cleared without emitting notifications for ungenerated occurrences
