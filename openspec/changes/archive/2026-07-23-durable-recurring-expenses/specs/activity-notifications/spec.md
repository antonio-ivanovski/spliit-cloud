## MODIFIED Requirements

### Requirement: Expense notification recipient eligibility
The system SHALL deliver expense notifications only to eligible active account-backed group members, normally excluding the actor, except that recurring creation SHALL also include its active original creator.

#### Scenario: Regular actor excluded
- **WHEN** the actor creates or changes a non-recurring expense
- **THEN** the system does not send that actor an expense notification

#### Scenario: Recurring creator included
- **WHEN** a recurring occurrence is generated and its original creator remains an active member
- **THEN** the creator receives the notification even though they are the activity actor

#### Scenario: Ineligible participant excluded
- **WHEN** an affected participant is pending, removed, left, unlinked, or has a placeholder address
- **THEN** the system does not deliver that participant an expense notification

## ADDED Requirements

### Requirement: Recurring notification content and transport
The system SHALL dispatch recurring-specific notification content through the existing fire-and-forget activity dispatcher and the RECURRING_EXPENSE_CREATED preference category. Schedule creation content SHALL include a human-readable recurrence rule and termination.

#### Scenario: Recurring schedule notification dispatched
- **WHEN** a recurring schedule is created with only occurrence one due through the current UTC date
- **THEN** the dispatcher sends one recurring-specific email and push notification describing the expense and recurrence rule to eligible affected participants and the eligible creator

#### Scenario: Generated recurring notification dispatched
- **WHEN** one later generated recurring expense is due outside a multi-occurrence batch
- **THEN** the dispatcher sends recurring-specific email and push content to eligible affected participants and the eligible creator

#### Scenario: Notification remains non-blocking
- **WHEN** recurring notification dispatch fails
- **THEN** the generated expense remains committed and the failure is logged

### Requirement: Recurring catch-up notification summaries
The system SHALL avoid sending one email or push notification for every overdue occurrence. Catch-up batching SHALL be participant-scoped and persisted while retaining one `RECURRING_EXPENSE_CREATED` activity per created expense. The summary event ID is stable across worker retries; channel delivery follows the existing fire-and-forget coordinator.

#### Scenario: Single due occurrence keeps normal delivery
- **WHEN** exactly one generated occurrence is due through the current UTC date
- **THEN** the dispatcher sends the normal recurring creation notification for that occurrence

#### Scenario: Multiple due occurrences are summarized
- **WHEN** two or more generated occurrences are due through the current UTC date during one catch-up window
- **THEN** the dispatcher suppresses individual generated-occurrence email/push delivery and sends each eligible participant one summary with the occurrence count and scheduled date range

#### Scenario: Initial past-dated creation is combined
- **WHEN** creating a recurring schedule makes occurrence one and at least one later occurrence immediately due
- **THEN** occurrence one seeds the persisted catch-up batch, its standalone delivery is suppressed, and each eligible participant receives one combined schedule-created summary containing the total count, date range, and recurrence rule

#### Scenario: Combined creation has no duplicate schedule message
- **WHEN** the creation catch-up summary is finalized
- **THEN** no separate schedule-created notification is dispatched for occurrence one

#### Scenario: Catch-up summary is not duplicated
- **WHEN** a materialization or worker retry repeats an occurrence in an open catch-up batch
- **THEN** persisted batch state and the stable summary event ID cause at most one summary event per participant scope for that batch

#### Scenario: Partial catch-up is finalized
- **WHEN** a non-empty catch-up batch is cancelled or the series is reconfigured before all overdue occurrences are generated
- **THEN** persisted batch state is cleared and no notification is emitted for ungenerated occurrences

### Requirement: Recurring bulk mutation summaries
The system SHALL retain individual activities while coalescing email and push delivery for recurring operations that affect multiple materialized expenses.

#### Scenario: One occurrence uses normal delivery
- **WHEN** a scoped edit or deletion affects exactly one materialized expense
- **THEN** the dispatcher sends the normal expense-changed notification for that expense

#### Scenario: Multiple edits use one summary
- **WHEN** this-and-future editing changes two or more materialized expenses
- **THEN** each eligible participant receives one EXPENSE_CHANGED summary containing the affected count and scheduled date range, while individual EXPENSE_UPDATED activities remain in the feed

#### Scenario: Multiple deletes use one summary
- **WHEN** this-and-following deletion removes two or more materialized expenses
- **THEN** each eligible participant receives one EXPENSE_CHANGED summary containing the affected count and scheduled date range, while individual EXPENSE_DELETED activities remain in the feed

#### Scenario: Bulk recipients are participant scoped
- **WHEN** affected occurrences contain different participant sets
- **THEN** summary recipients are the union of eligible active account-backed participants from all affected rows, with the actor excluded

### Requirement: Recurrence stopping notification
The system SHALL dispatch recurrence stopping through the deletion-style expense notification delivery under EXPENSE_CHANGED.

#### Scenario: Standalone stop notifies template participants
- **WHEN** a user stops an active or paused recurrence without deleting expenses
- **THEN** eligible active account-backed participants represented in the series template receive one recurrence-stopped notification and the actor is excluded

#### Scenario: Delete and stop is combined
- **WHEN** this-and-following deletion also stops recurrence
- **THEN** the single normal deletion notification or multi-delete summary states that recurrence was stopped and no standalone stop notification is sent
