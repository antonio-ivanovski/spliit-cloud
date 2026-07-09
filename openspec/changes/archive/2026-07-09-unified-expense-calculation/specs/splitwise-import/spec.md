## MODIFIED Requirements

### Requirement: Splitwise paidBy and paidFor reconstruction
For each parsed row the parser SHALL reconstruct `paidBy` and `paidFor` so the per-participant balances reconcile with the `Total balance` footer in the export, as follows:

- `paidFor` contains every **negative-value** participant with `shares = abs(raw) * 100` (their consumed share), followed by every **positive-value** participant with `shares = floor(remainingCost / positiveCount)` where `remainingCost = amount - sum(negativeShares)`. Any rounding drift on `paidFor` is absorbed by incrementing the positive entries in order until their sum equals `remainingCost` (each at most +1 cent).
- `paidBy` contains every **positive-value** participant with `shares = abs(raw) * 100 + consumedShare` where `consumedShare` is the `paidFor` share attributed to that participant. Any rounding drift on `paidBy` is absorbed by adding the drift to the largest `paidBy` entry.

The parser SHALL use `serializePaidFor` and `serializePaidBy` from the `share-calculation` core for share normalization. Inline `Math.floor` + `+= 1` distribution loops SHALL be removed and replaced by routing through the domain helper. The `guessSplitMode` auto-detection logic is unchanged.

#### Scenario: Even split between two participants

- **WHEN** a row has `Antonio: 180.00, Dejan: -180.00` with `Cost: 360.00`
- **THEN** `paidBySourceId` is Antonio, `paidBy: [{ Antonio, 36000 }]`, `paidFor: [{ Dejan, 18000 }, { Antonio, 18000 }]`, and `splitMode: 'EVENLY'`

#### Scenario: Uneven split produces BY_AMOUNT

- **WHEN** a row has `Antonio: 60.00, Dejan: -40.00` with `Cost: 100.00`
- **THEN** `paidBySourceId` is Antonio, `paidBy: [{ Antonio, 6667 }]`, `paidFor: [{ Dejan, 4000 }, { Antonio, 6000 }]`, and `splitMode: 'BY_AMOUNT'`

#### Scenario: paidFor shares sum exactly to amount

- **WHEN** the parsed row has any combination of positive and negative values
- **THEN** the sum of `paidFor` `shares` equals the row `amount` (cents), with at most 1 cent of drift absorbed by positive entries

#### Scenario: Share computation uses domain serializers

- **WHEN** the parser computes `paidFor` and `paidBy` shares
- **THEN** it calls `serializePaidFor` and `serializePaidBy` from the `share-calculation` core and does not contain inline `Math.floor` + `+= 1` distribution loops

### Requirement: Splitwise cross-currency import conversion
The Splitwise CSV parser always produces expenses in the row currency with `originalAmount`, `originalCurrency`, and `conversionRate` set to `null`. Cross-currency conversion SHALL be handled by `buildImportBatch` using the unified `share-calculation` core: the converted `amount` SHALL use `Decimal(originalAmount).mul(rate)` and `distributeRemainder` instead of `Math.round(amount * rate)`. `paidByList.shares` SHALL stay in the source (row) currency; `paidFor` BY_AMOUNT shares SHALL convert to ledger currency via `serializePaidFor` with `conversionRate`; unitless shares (EVENLY/BY_SHARES/BY_PERCENTAGE) SHALL NOT be converted. The inline largest-magnitude drift correctors in `buildImportBatch` SHALL be removed and replaced by `distributeRemainder`.

#### Scenario: Splitwise cross-currency conversion uses Decimal precision

- **WHEN** `buildImportBatch` converts a Splitwise expense from a foreign currency to the destination ledger currency
- **THEN** the converted `amount` uses `Decimal(originalAmount).mul(rate)` and `distributeRemainder`, not `Math.round(amount * rate)`

#### Scenario: Splitwise cross-currency paidBy stays in source currency

- **WHEN** a Splitwise expense in a foreign currency is converted by `buildImportBatch`
- **THEN** `paidByList.shares` remain in the source (row) currency cents, matching the convention that `getBalances` applies `conversionRate` at read time

#### Scenario: Splitwise cross-currency paidFor BY_AMOUNT converts to ledger currency

- **WHEN** a Splitwise expense with `splitMode: 'BY_AMOUNT'` in a foreign currency is converted by `buildImportBatch`
- **THEN** `paidFor.shares` are converted to ledger-currency cents via `serializePaidFor` with `conversionRate`

#### Scenario: No inline drift correctors in buildImportBatch

- **WHEN** `buildImportBatch` converts shares for a cross-currency Splitwise expense
- **THEN** it does not contain largest-magnitude-absorbs-drift loops; drift is handled by `distributeRemainder` in the unified core
