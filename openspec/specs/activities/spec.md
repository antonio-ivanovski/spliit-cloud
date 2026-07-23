## MODIFIED Requirements

### Requirement: Generic actor types including SYSTEM
The system SHALL support ACCOUNT, LEDGER_PARTICIPANT, and SYSTEM actor types for activity events and SHALL attribute generated recurring expenses to their original creator when recoverable.

#### Scenario: Original creator actor for recurring expense
- **WHEN** a recurring expense is auto-created and the series has a valid creator account
- **THEN** the activity actor type is ACCOUNT with the original creator account identifier

#### Scenario: SYSTEM fallback for migrated recurring expense
- **WHEN** a migrated series has no recoverable creator account
- **THEN** generated activity uses the SYSTEM actor

## ADDED Requirements

### Requirement: Recurring expense activity taxonomy
The system SHALL record every created recurring occurrence as a RECURRING_EXPENSE_CREATED activity with recurring-specific display content, including the manually entered first occurrence that creates the schedule.

#### Scenario: Generated activity
- **WHEN** the worker creates an occurrence
- **THEN** it atomically records RECURRING_EXPENSE_CREATED for that expense

#### Scenario: Initial recurring activity
- **WHEN** a user creates occurrence one with recurrence enabled
- **THEN** the system records RECURRING_EXPENSE_CREATED for that expense with the recurrence rule and termination metadata

### Requirement: Individual recurring bulk-mutation activities
The system SHALL retain one activity per materialized expense changed or removed by a recurring scoped mutation, even when notification delivery is summarized.

#### Scenario: Multiple occurrences edited
- **WHEN** this-and-future editing changes multiple materialized expenses
- **THEN** each changed expense receives its own EXPENSE_UPDATED activity containing that row's change details

#### Scenario: Multiple occurrences deleted
- **WHEN** this-and-following deletion removes multiple materialized expenses
- **THEN** each removed expense receives its own EXPENSE_DELETED activity containing a pre-deletion snapshot sufficient for feed rendering

### Requirement: Recurrence stop activity
The system SHALL record a recurrence-stopped activity when a schedule is stopped either independently or as part of delete-and-stop.

#### Scenario: Standalone stop activity
- **WHEN** an active or paused recurring schedule is stopped without deleting expenses
- **THEN** one recurrence-stopped activity identifies the series, triggering expense, recurrence rule, and affected participants

#### Scenario: Delete and stop audit trail
- **WHEN** this-and-following deletion also stops the schedule
- **THEN** the individual deletion activities and the stopped state are auditable without creating duplicate notification delivery
