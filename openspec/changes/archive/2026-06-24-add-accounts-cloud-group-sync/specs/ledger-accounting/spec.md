## ADDED Requirements

### Requirement: Ledger-backed groups

The system SHALL create one Ledger for every group, including imported groups, and SHALL attach expenses, balances, activities, documents, recurrence, exports, and base currency to the Ledger accounting core.

#### Scenario: Create native group

- **WHEN** an authenticated user creates a group
- **THEN** the system creates a group and an associated Ledger

#### Scenario: Query group expenses

- **WHEN** the system lists expenses for a group
- **THEN** it reads expenses from the group Ledger

### Requirement: Ledger participants

The system SHALL use LedgerParticipant records as the parties referenced by expense payer and paid-for rows.

#### Scenario: Create expense

- **WHEN** an expense is created
- **THEN** the paid-by and paid-for references are LedgerParticipant IDs

#### Scenario: Calculate balances

- **WHEN** balances are calculated
- **THEN** the system calculates by LedgerParticipant across the Ledger expenses

### Requirement: Ledger base currency

The system SHALL store base currency on the Ledger and SHALL store expense amounts in ledger-currency minor units.

#### Scenario: Expense in ledger currency

- **WHEN** an expense is entered in the Ledger base currency
- **THEN** the system stores the amount in Ledger base-currency minor units without original-currency conversion fields

#### Scenario: Expense in different currency

- **WHEN** an expense is entered in a currency different from the Ledger base currency
- **THEN** the system stores the normalized amount in Ledger base-currency minor units and preserves original amount, original currency, and conversion rate

#### Scenario: Direct ledger base currency

- **WHEN** a user creates a direct Ledger
- **THEN** the system suggests a base currency from account preference or locale and allows the user to choose a different base currency

### Requirement: Existing split units

The system SHALL preserve current split units: BY_AMOUNT in ledger-currency minor units, BY_PERCENTAGE in basis points out of 10000, EVENLY as equal participation, and BY_SHARES as relative shares.

#### Scenario: Percentage split

- **WHEN** a percentage split is saved
- **THEN** the paid-for shares sum to 10000 basis points

#### Scenario: Amount split

- **WHEN** an amount split is saved
- **THEN** the paid-for shares are stored in Ledger base-currency minor units
