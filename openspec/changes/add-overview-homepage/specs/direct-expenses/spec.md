## ADDED Requirements

### Requirement: Direct relationship summaries
The overview SHALL show direct relationship summaries when direct Ledgers exist.

#### Scenario: Direct ledger with balance
- **WHEN** the user has a direct Ledger with an unsettled balance
- **THEN** the overview shows that direct relationship and balance

### Requirement: Direct relationship pinning
The system SHALL allow account-scoped pinning for direct relationships and SHALL NOT support archiving direct relationships.

#### Scenario: Pinned direct relationship
- **WHEN** a user pins a direct relationship
- **THEN** the overview prioritizes that direct relationship for that account

#### Scenario: Attempt direct archive
- **WHEN** a user attempts to archive a direct relationship
- **THEN** the system does not offer or perform direct relationship archiving
