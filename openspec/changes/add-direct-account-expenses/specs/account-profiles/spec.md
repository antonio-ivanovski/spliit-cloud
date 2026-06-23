## ADDED Requirements

### Requirement: Direct counterparty lookup
The system SHALL allow users to select direct expense counterparties by existing account identity or invited email.

#### Scenario: Existing account selected
- **WHEN** a user selects an existing account as direct counterparty
- **THEN** the system creates or reuses the direct Ledger for the account pair

#### Scenario: Invited email selected
- **WHEN** a user enters an email that does not belong to an account
- **THEN** the system creates a pending direct participant for that email
