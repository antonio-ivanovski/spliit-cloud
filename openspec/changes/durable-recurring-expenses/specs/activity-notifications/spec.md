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
The system SHALL dispatch recurring-specific notification content through the existing fire-and-forget activity dispatcher and existing EXPENSE_CREATED preference category.

#### Scenario: Recurring notification dispatched
- **WHEN** a generated recurring expense transaction commits
- **THEN** the current dispatcher sends recurring-specific email and push content to eligible affected participants and the eligible creator

#### Scenario: Notification remains non-blocking
- **WHEN** recurring notification dispatch fails
- **THEN** the generated expense remains committed and the failure is logged
