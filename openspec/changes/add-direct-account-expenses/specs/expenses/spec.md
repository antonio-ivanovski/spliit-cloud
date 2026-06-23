## ADDED Requirements

### Requirement: Ledger-scoped expense APIs
The system SHALL support expense create, update, delete, list, and get operations against DIRECT Ledgers without duplicating group-specific expense tables.

#### Scenario: Create direct expense
- **WHEN** a participant creates an expense in a DIRECT Ledger
- **THEN** the system stores the expense using shared Ledger expense tables

#### Scenario: Edit direct expense
- **WHEN** a participant edits a direct expense
- **THEN** the system applies the same permanent edit behavior used for group expenses
