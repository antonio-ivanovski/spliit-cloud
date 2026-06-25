## MODIFIED Requirements

### Requirement: Ledger base currency
The system SHALL store base currency on the Ledger and SHALL store expense amounts in ledger-currency minor units. For converted expenses, the system SHALL compute persisted ledger-currency amounts server-side from original/input currency values and the server-resolved exchange rate.

#### Scenario: Expense in ledger currency
- **WHEN** an expense is entered in the Ledger base currency
- **THEN** the system stores the amount in Ledger base-currency minor units without original-currency conversion fields

#### Scenario: Expense in different currency
- **WHEN** an expense is entered in a currency different from the Ledger base currency
- **THEN** the system stores the server-normalized amount in Ledger base-currency minor units and preserves original amount, original currency, server-used conversion rate, and provider rate date/as-of metadata

#### Scenario: Client conversion is preview-only
- **WHEN** the client submits a converted expense
- **THEN** the system ignores any client-provided converted amount or conversion rate for persistence and computes the persisted values on the server

#### Scenario: Direct ledger base currency
- **WHEN** a user creates a direct Ledger
- **THEN** the system suggests a base currency from account preference or locale and allows the user to choose a different base currency

### Requirement: Existing split units
The system SHALL preserve current split units: BY_AMOUNT is stored in ledger-currency minor units, BY_PERCENTAGE in basis points out of 10000, EVENLY as equal participation, and BY_SHARES as relative shares. For converted expenses, BY_AMOUNT split inputs SHALL be interpreted in the expense original/input currency and normalized server-side into Ledger base-currency minor units before persistence.

#### Scenario: Percentage split
- **WHEN** a percentage split is saved
- **THEN** the paid-for shares sum to 10000 basis points

#### Scenario: Amount split in ledger currency
- **WHEN** an amount split is saved for an expense entered in the Ledger base currency
- **THEN** the paid-for shares are stored in Ledger base-currency minor units

#### Scenario: Amount split in original currency
- **WHEN** an amount split is saved for an expense entered in a different currency than the Ledger base currency
- **THEN** the system interprets the paid-for share amounts in the expense original/input currency, preserves the original paid-for share amounts for edit-form replay, and stores normalized Ledger base-currency minor-unit shares

#### Scenario: Converted amount split uses largest remainder rounding
- **WHEN** the system normalizes amount-based shares for a converted expense
- **THEN** the system uses largest-remainder deterministic minor-unit rounding so the persisted Ledger-currency shares sum to the persisted Ledger-currency expense amount

#### Scenario: Non-amount split modes on converted expenses
- **WHEN** an expense entered in a different currency than the Ledger base currency uses EVENLY, BY_PERCENTAGE, or BY_SHARES
- **THEN** the system converts the expense total to Ledger base-currency minor units and applies the existing split semantics to the converted total

## ADDED Requirements

### Requirement: Currency rate lookup cache
The system SHALL fetch exchange rates through the API and SHALL cache provider responses temporarily in memory to avoid repeated external currency-provider calls for the same currency pair and requested date.

#### Scenario: Cache miss
- **WHEN** a conversion rate is requested for a supported pair and date that is not in the cache
- **THEN** the system fetches the rate from the provider, stores it in the in-memory cache, and returns the rate with provider date/as-of metadata

#### Scenario: Cache hit
- **WHEN** a conversion rate is requested for a supported pair and date that is already cached and fresh
- **THEN** the system returns the cached rate without calling the external provider

#### Scenario: Unsupported conversion
- **WHEN** a conversion rate is requested for an unsupported currency pair
- **THEN** the system rejects the request with a validation error and does not create or update the converted expense

#### Scenario: Provider unavailable with recent cached fallback
- **WHEN** a conversion rate is requested, the provider is unavailable, the exact requested date is not cached, and a cached rate for the same pair exists within 7 days of the requested expense date
- **THEN** the system may use the cached rate and persists the normal conversion rate and as-of metadata

#### Scenario: Provider unavailable without sane cached fallback
- **WHEN** a conversion rate is requested, the provider is unavailable, and no cached rate for the same pair exists within 7 days of the requested expense date
- **THEN** the system rejects the converted expense save with a user-facing error

### Requirement: Supported currency enforcement
The system SHALL allow only supported ISO currency codes for Ledger base currencies and expense selected currencies.

#### Scenario: Select group currency
- **WHEN** a user creates or updates a group currency
- **THEN** the system accepts only a supported ISO currency code

#### Scenario: Select expense currency
- **WHEN** a user creates or updates an expense currency
- **THEN** the system accepts only a supported ISO currency code

#### Scenario: Existing custom currency group
- **WHEN** an existing group has a custom or empty currency value
- **THEN** the system remains able to read the group but requires a supported ISO currency for future currency changes subject to the existing expense-count restriction

### Requirement: Ledger-currency accounting invariant
The system SHALL calculate balances, reimbursements, settlements, summaries, and statistics only from Ledger base-currency amounts and shares.

#### Scenario: Converted expense affects balances
- **WHEN** balances are calculated for a Ledger containing converted expenses
- **THEN** the calculation uses the persisted Ledger-currency expense amounts and paid-for shares, not original-currency metadata

#### Scenario: Balance display
- **WHEN** a user views balances or settlement suggestions
- **THEN** the system displays only Ledger base-currency amounts
