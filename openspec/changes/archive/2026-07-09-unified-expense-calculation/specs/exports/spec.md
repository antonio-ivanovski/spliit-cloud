## ADDED Requirements

### Requirement: CSV export uses unified share calculation
The CSV export SHALL compute per-participant shares using `calculateShares` from the `share-calculation` core instead of inline `payerAmount - participantAmountShare` math. Each participant's net amount SHALL be `expense.amount - shares[participantId]` for the payer and `-shares[participantId]` for non-payers.

#### Scenario: CSV per-participant share matches calculateShares
- **WHEN** the CSV export computes per-participant net amounts for an expense
- **THEN** it calls `calculateShares(expense)` and uses the result to compute each participant's net, rather than inline division math

#### Scenario: CSV net amounts are formatted as strings
- **WHEN** the CSV export writes per-participant net amounts
- **THEN** it emits `formatAmountAsDecimal(netAmount, currency)` as a string to preserve trailing zeros

### Requirement: CSV export currency semantics
The CSV export per-participant net columns SHALL be in the **ledger currency** (computed from `calculateShares(expense)` which uses `expense.amount`). The `Original cost`, `Original currency`, and `Conversion rate` columns SHALL be retained as informational columns in the original currency — they SHALL NOT be summed against the ledger-currency net columns. The `Cost` column SHALL show the ledger-currency `expense.amount`.

#### Scenario: Cross-currency CSV net columns are in ledger currency
- **WHEN** the CSV export processes a cross-currency expense (e.g., paid in USD, ledger in EUR)
- **THEN** the per-participant net columns are in ledger currency (EUR) and sum to the `Cost` column value

#### Scenario: Cross-currency CSV original columns are informational
- **WHEN** the CSV export processes a cross-currency expense
- **THEN** the `Original cost`, `Original currency`, and `Conversion rate` columns carry the original-currency values and are not used in per-participant net computation

#### Scenario: CSV per-participant nets sum to Cost
- **WHEN** the CSV export writes per-participant net columns for any expense
- **THEN** the sum of all participant net columns equals zero (since payer net = amount - share and non-payer net = -share, and shares sum to amount)

### Requirement: JSON export currency denomination
The JSON export SHALL emit raw stored values with explicit currency denomination: `amount` and `paidFor.shares` (for BY_AMOUNT) SHALL be in ledger-currency minor units; `originalAmount` SHALL be in original-currency minor units; `paidByList.shares` SHALL be in original-currency minor units for cross-currency expenses and ledger-currency minor units otherwise. The JSON export SHALL include the ledger `currencyCode` at the group level.

#### Scenario: JSON export cross-currency fields
- **WHEN** the JSON export processes a cross-currency expense
- **THEN** `amount` is in ledger currency, `originalAmount` is in original currency, and `paidByList.shares` are in original currency

#### Scenario: JSON export same-currency fields
- **WHEN** the JSON export processes a same-currency expense
- **THEN** `amount` and all `shares` are in ledger currency and `originalAmount` / `originalCurrency` / `conversionRate` are null
