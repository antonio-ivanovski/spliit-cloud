## MODIFIED Requirements

### Requirement: Ledger base currency
The system SHALL store base currency on the Ledger and SHALL store a ledger-currency expense total in minor units for accounting. For converted expenses, the system SHALL compute that ledger-currency total server-side from original/input currency values and the source-resolved conversion rate. Original amount, shares, and items SHALL remain in the expense original/input currency.

#### Scenario: Expense in ledger currency
- **WHEN** an expense is entered in the Ledger base currency
- **THEN** the system stores null `conversionSource`, stores the amount in Ledger base-currency minor units, and does not require exchange or custom conversion metadata

#### Scenario: Expense in different currency with exchange rate
- **WHEN** an expense is entered in a different supported ISO currency than the Ledger base and `conversionSource` is `EXCHANGE`
- **THEN** the system resolves the rate server-side, stores the server-normalized ledger-currency total, and preserves original amount, original currency, `conversionSource`, conversion rate

#### Scenario: Expense in different currency with custom rate
- **WHEN** an expense is entered in a currency different from the Ledger base and `conversionSource` is `CUSTOM`
- **THEN** the system accepts a positive user-supplied rate, computes the ledger-currency total server-side, and preserves original amount, original currency, `conversionSource`, and conversion rate

#### Scenario: Client conversion is preview-only
- **WHEN** the client submits an expense that requires conversion
- **THEN** the system does not treat client-provided ledger totals as authoritative and computes persisted ledger values on the server from original/input values and the source-resolved rate

#### Scenario: Direct ledger base currency
- **WHEN** a user creates a direct Ledger
- **THEN** the system suggests a base currency from account preference or locale and allows the user to choose a different base currency (supported ISO or custom)

### Requirement: Existing split units
The system SHALL preserve current split units: `BY_PERCENTAGE` in basis points out of 10000, `EVENLY` as equal participation, and `BY_SHARES` as relative shares. For `BY_AMOUNT` and itemized line amounts, the system SHALL store values in the expense original/input currency. Accounting paths SHALL convert those original-currency values into Ledger base-currency minor units using the expense's persisted conversion rate when the expense is converted.

#### Scenario: Percentage split
- **WHEN** a percentage split is saved
- **THEN** the paid-for shares sum to 10000 basis points

#### Scenario: Amount split in ledger currency
- **WHEN** an amount split is saved for an expense with null `conversionSource`
- **THEN** the paid-for share amounts are stored in Ledger base-currency minor units (which equal the original/input currency)

#### Scenario: Amount split in original currency
- **WHEN** an amount split is saved for a converted expense (`EXCHANGE` or `CUSTOM`)
- **THEN** the system stores paid-for share amounts in the expense original/input currency summing to the original expense amount, and balance calculations convert them to Ledger base-currency minor units using the persisted rate with deterministic remainder distribution

#### Scenario: Itemized amounts in original currency
- **WHEN** an itemized expense is saved
- **THEN** item unit prices and line amounts are stored in the expense original/input currency

#### Scenario: Non-amount split modes on converted expenses
- **WHEN** a converted expense uses `EVENLY`, `BY_PERCENTAGE`, or `BY_SHARES`
- **THEN** the system stores the original total and conversion metadata, computes the ledger-currency total server-side, and applies the existing split semantics for accounting against that ledger total

#### Scenario: Single currency per expense
- **WHEN** an expense is created or updated
- **THEN** amount, paid-by amount shares, paid-for amount shares, and items all use the same expense currency (never mixed currencies within one expense)

## ADDED Requirements

### Requirement: Conversion source
The system SHALL persist `conversionSource` on each expense: `EXCHANGE` or `CUSTOM` (null when same currency). Users SHALL be able to choose and later change the source when the expense currency differs from the ledger base (subject to currency/provider constraints), using the existing exchange/custom rate actions in the expense form. The exchange option SHALL be labeled with localized “exchange rate” wording and SHALL show a small note that rates come from https://frankfurter.dev/ and their API.

#### Scenario: Same-currency forces none
- **WHEN** the selected expense currency equals the Ledger base currency
- **THEN** the system stores null `conversionSource` and does not store a conversion rate

#### Scenario: Exchange source requires supported pair
- **WHEN** `conversionSource` is `EXCHANGE`
- **THEN** both expense currency and Ledger base currency are supported ISO codes the provider can price; otherwise the system rejects the save

#### Scenario: Custom currency requires custom rate when converted
- **WHEN** an expense currency or Ledger base currency is custom/unsupported for exchange and the two differ
- **THEN** the system requires `conversionSource` `CUSTOM` and a positive custom rate

#### Scenario: Edit conversion source
- **WHEN** a user edits a converted expense and switches between `EXCHANGE` and `CUSTOM`
- **THEN** the system re-resolves or re-applies the rate per the new source and recomputes the ledger-currency total

### Requirement: Currency rate lookup cache
The system SHALL fetch exchange rates through the existing API rate service and SHALL cache provider responses in memory for the same currency pair and requested date. Cache entries for historical dates are stable and reusable. The bulk rate endpoint remains available for previews; persistence paths use the same service server-side.

#### Scenario: Cache miss
- **WHEN** a conversion rate is requested for a supported pair and date that is not in the cache
- **THEN** the system fetches the rate from the provider, stores it in the in-memory cache, and returns the rate with provider date/as-of metadata

#### Scenario: Cache hit
- **WHEN** a conversion rate is requested for a supported pair and date that is already cached
- **THEN** the system returns the cached rate without calling the external provider

#### Scenario: Unsupported conversion under exchange source
- **WHEN** `conversionSource` is `EXCHANGE` and the pair is unsupported
- **THEN** the system rejects the request with a validation error and does not create or update the expense under `EXCHANGE`

#### Scenario: Provider unavailable under exchange source
- **WHEN** `conversionSource` is `EXCHANGE` and the provider is unavailable and the rate is not cached
- **THEN** the system rejects the converted expense save with a user-facing error while still allowing same-currency and `CUSTOM` saves

### Requirement: Exchange rate date selection
For `conversionSource` `EXCHANGE`, the system SHALL resolve rates using the expense date for past and current dates, and SHALL use today's date when the expense date is in the future.

#### Scenario: Past expense date
- **WHEN** an `EXCHANGE` expense has an expense date on or before today
- **THEN** the system requests the rate for that expense date

#### Scenario: Future expense date
- **WHEN** an `EXCHANGE` expense has an expense date after today
- **THEN** the system requests today's rate, persists that rate, and the expense UI indicates that today's rate is used because the expense date is in the future

### Requirement: Ledger-currency accounting invariant
The system SHALL calculate balances, reimbursements, settlements, summaries, and statistics only from Ledger base-currency amounts derived via each expense's persisted conversion data.

#### Scenario: Converted expense affects balances
- **WHEN** balances are calculated for a Ledger containing converted expenses
- **THEN** the calculation converts original-currency amounts and amount-based shares using each expense's persisted rate so that paid and paid-for sides reconcile in Ledger currency

#### Scenario: Balance display
- **WHEN** a user views balances or settlement suggestions
- **THEN** the system displays only Ledger base-currency amounts
