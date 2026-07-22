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
The system SHALL record generated recurring occurrences as RECURRING_EXPENSE_CREATED activities with recurring-specific display content.

#### Scenario: Generated activity
- **WHEN** the worker creates an occurrence
- **THEN** it atomically records RECURRING_EXPENSE_CREATED for that expense
