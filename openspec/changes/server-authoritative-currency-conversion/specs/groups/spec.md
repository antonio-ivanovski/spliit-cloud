## ADDED Requirements

### Requirement: Immutable group currency after expenses
The system SHALL reject changes to a group Ledger base currency after the Ledger contains expenses.

#### Scenario: Change currency before expenses
- **WHEN** a group Ledger has no expenses
- **THEN** the owner may change the Ledger base currency through the group update flow

#### Scenario: Change currency after expenses
- **WHEN** a group Ledger has one or more expenses
- **THEN** the system rejects attempts to change the Ledger base currency and preserves the existing currency

#### Scenario: Update non-currency fields after expenses
- **WHEN** a group Ledger has one or more expenses and the user updates non-currency group fields
- **THEN** the system applies the non-currency updates without changing the Ledger base currency

### Requirement: Supported group currencies
The system SHALL support only configured ISO currency codes for new and updated group currencies.

#### Scenario: Create group with supported currency
- **WHEN** a user creates a group with a supported ISO currency code
- **THEN** the system stores that code as the Ledger base currency

#### Scenario: Create group with custom currency
- **WHEN** a user attempts to create a group with a custom, empty, or unsupported currency code
- **THEN** the system rejects the group creation
