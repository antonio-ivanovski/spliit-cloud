## ADDED Requirements

### Requirement: Ledger balance reuse
The system SHALL calculate group and direct balances through shared Ledger balance helpers.

#### Scenario: Group balance calculation
- **WHEN** the system calculates a group balance
- **THEN** it uses the group's Ledger expenses

#### Scenario: Direct balance calculation
- **WHEN** the system calculates a direct balance
- **THEN** it uses the direct relationship's Ledger expenses
