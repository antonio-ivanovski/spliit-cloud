## ADDED Requirements

### Requirement: Ledger activity actors
The system SHALL record activity against the Ledger and SHALL associate activity actors with authenticated accounts or member-backed ledger participants where applicable.

#### Scenario: Expense created
- **WHEN** an authenticated member creates an expense
- **THEN** the system records Ledger activity with that actor

#### Scenario: Direct ledger future compatibility
- **WHEN** a non-group Ledger records an activity
- **THEN** the activity model does not require a group ID
