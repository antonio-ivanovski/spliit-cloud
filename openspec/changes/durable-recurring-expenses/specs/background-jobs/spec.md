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
