## ADDED Requirements

### Requirement: Direct balance summary
The system SHALL calculate direct account balances from DIRECT Ledger expenses using the same Ledger balance core as groups.

#### Scenario: User is owed money
- **WHEN** direct Ledger expenses result in the current account being owed money
- **THEN** the direct balance summary shows a positive amount for the current account

#### Scenario: User owes money
- **WHEN** direct Ledger expenses result in the current account owing money
- **THEN** the direct balance summary shows a negative amount for the current account

### Requirement: Pending direct balances
The system SHALL show pending invited-email direct expenses to the inviter and SHALL associate them with the invitee account only after matching-email authentication.

#### Scenario: Before invite acceptance
- **WHEN** an invited direct counterparty has not authenticated
- **THEN** only the inviter sees the pending direct Ledger balance

#### Scenario: After invite acceptance
- **WHEN** the invited direct counterparty authenticates with the matching email
- **THEN** the direct Ledger balance appears for both accounts
