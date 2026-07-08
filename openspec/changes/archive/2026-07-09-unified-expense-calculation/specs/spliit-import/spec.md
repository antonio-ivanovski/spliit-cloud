## ADDED Requirements

### Requirement: Spliit CSV import uses share-calculation serializers
The Spliit CSV parser SHALL use `serializePaidFor` from the `share-calculation` core for share normalization instead of inline drift correctors. The inline `drift` correction loop (largest-entry-absorbs-drift) SHALL be removed and replaced by routing through the domain helper.

#### Scenario: Spliit CSV paidFor shares serialized via domain helper
- **WHEN** the Spliit CSV parser computes `paidFor` shares for a parsed expense
- **THEN** it calls `serializePaidFor` from the `share-calculation` core instead of computing and drift-correcting cents inline

#### Scenario: No inline drift corrector
- **WHEN** the Spliit CSV parser encounters shares that don't sum to the amount
- **THEN** the parser does not contain an inline `drift` variable or largest-entry-absorbs-drift loop; drift handling is deferred to the read-side `calculateShares`

### Requirement: Spliit CSV import cross-currency normalization
The Spliit CSV parser SHALL preserve the prior-convention quirk where `paidBy` shares are sourced from the Original-cost column (original-currency cents) while `paidFor` shares are in row-currency cents. The `buildImportBatch` function SHALL normalize these via `serializePaidBy` and `serializePaidFor` with `conversionRate`, following the cross-currency serializer convention: `paidByList.shares` stay in original currency, `paidFor` BY_AMOUNT shares convert to ledger currency, and unitless shares (EVENLY/BY_SHARES/BY_PERCENTAGE) are not converted. The converted `amount` SHALL use `Decimal(originalAmount).mul(rate)` and `distributeRemainder` instead of `Math.round(amount * rate)`.

#### Scenario: Spliit CSV prior-conversion expense
- **WHEN** a Spliit CSV row has Original cost, Original currency, and Conversion rate columns populated
- **THEN** the parser sets `originalAmount`, `originalCurrency`, and `conversionRate` and sources `paidBy` shares from the original-cost cents

#### Scenario: Cross-currency import conversion uses Decimal precision
- **WHEN** `buildImportBatch` converts a cross-currency Spliit CSV expense to the destination ledger currency
- **THEN** it uses `Decimal(originalAmount).mul(rate)` and `distributeRemainder` for the converted amount, not `Math.round(amount * rate)`

#### Scenario: Cross-currency import paidBy stays in original currency
- **WHEN** a cross-currency Spliit CSV expense is converted by `buildImportBatch`
- **THEN** `paidByList.shares` remain in original-currency cents (not rate-multiplied), matching the convention that `getBalances` applies `conversionRate` at read time

#### Scenario: Cross-currency import paidFor BY_AMOUNT converts to ledger currency
- **WHEN** a cross-currency Spliit CSV expense with `splitMode: 'BY_AMOUNT'` is converted by `buildImportBatch`
- **THEN** `paidFor.shares` are converted to ledger-currency cents via `serializePaidFor` with `conversionRate`

#### Scenario: Cross-currency import unitless shares not converted
- **WHEN** a cross-currency Spliit CSV expense with `splitMode: 'EVENLY'` or `'BY_SHARES'` or `'BY_PERCENTAGE'` is converted by `buildImportBatch`
- **THEN** `paidFor.shares` are not multiplied by the conversion rate; they remain unitless weights or basis points
