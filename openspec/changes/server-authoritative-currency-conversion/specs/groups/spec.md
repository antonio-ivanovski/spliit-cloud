## ADDED Requirements

### Requirement: Immutable group currency after expenses
The system SHALL reject changes to a group Ledger base currency after the Ledger contains expenses.

#### Scenario: Change currency before expenses
- **WHEN** a group Ledger has no expenses
- **THEN** the owner may change the Ledger base currency through the group update flow (supported ISO or custom)

#### Scenario: Change currency after expenses
- **WHEN** a group Ledger has one or more expenses
- **THEN** the system rejects attempts to change the Ledger base currency and preserves the existing currency

#### Scenario: Update non-currency fields after expenses
- **WHEN** a group Ledger has one or more expenses and the user updates non-currency group fields
- **THEN** the system applies the non-currency updates without changing the Ledger base currency

### Requirement: Group currency selection
The system SHALL allow supported ISO currency codes and custom currencies for new and updated group currencies, subject to the immutable-after-expenses rule. Custom base currencies SHALL not use exchange-provider conversion for expenses; converted expenses against a custom base require custom rates.

#### Scenario: Create group with supported currency
- **WHEN** a user creates a group with a supported ISO currency code
- **THEN** the system stores that code as the Ledger base currency

#### Scenario: Create group with custom currency
- **WHEN** a user creates a group with a custom currency
- **THEN** the system stores the custom currency representation and allows later expenses in that base with `conversionSource` `NONE` or in other currencies with `conversionSource` `CUSTOM`
