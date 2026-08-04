## Purpose

Defines the exact share-calculation core shared by expense previews, balances, and serialization: rational (BigInt) split math, integer-cent remainder distribution, seed-based tie-breaks, and the write-side storage units for every split mode — including fixed-point BY_SHARES weights where one displayed share equals 100 stored units.

## Requirements

### Requirement: Shape-based exact share calculation
The system SHALL compute per-participant exact shares via a single `calculateExactShares` function that accepts a shape-based input (`{ amount, splitMode, participants }`) and returns `Record<participantId, ExactAmount>` without truncation, using native `BigInt`-based rational arithmetic (`{ numerator: bigint, denominator: bigint }`). The function SHALL handle all five split modes: EVENLY (`amount / N`), BY_SHARES (`amount * shares / Σshares`), BY_PERCENTAGE (`amount * shares / 10000`), BY_AMOUNT (literal `shares`), and ITEMIZED (literal `shares`). The same function SHALL work for expense paidFor sides, expense paidBy sides, and individual expense items.

> **Note on precision**: All money is stored as integer minor units of the relevant currency (cents for typical fiat; smaller units for high-decimal crypto per catalog `decimal_digits`). Conversion math uses `BigInt` rational arithmetic for exact intermediate values.

#### Scenario: Expense paidFor side
- **WHEN** the system computes shares for an expense's paidFor side
- **THEN** it calls `calculateExactShares` with `{ amount: expense.amount, splitMode: expense.splitMode, participants: expense.paidFor }`

#### Scenario: Expense paidBy side
- **WHEN** the system computes shares for an expense's paidBy side
- **THEN** it calls `calculateExactShares` with `{ amount: payerBase, splitMode: expense.paidBySplitMode, participants: expense.paidByList }` where `payerBase` is `originalAmount` for cross-currency expenses and `expense.amount` otherwise

#### Scenario: Expense item
- **WHEN** the system computes shares for a single item within an ITEMIZED expense
- **THEN** it calls `calculateExactShares` with `{ amount: item.amount, splitMode: item.splitMode, participants: item.paidFor }`

### Requirement: Remainder distribution algorithm
The system SHALL provide a single `distributeRemainder(exactShares, amount, opts)` function that converts `ExactAmount` (native `BigInt` rational) shares to integer cents. The algorithm SHALL: (1) truncate each share toward zero (`floor` for positive, `ceil` for negative), (2) compute `diff = amount - Σ(truncatedShares)`, (3) if `diff` is zero, return; (4) if `opts.payerId` is set, give the entire `diff` to the payer (BY_AMOUNT/ITEMIZED literal mode fallback); (5) otherwise distribute `|diff|` cents one at a time to participants ordered by descending fractional-part magnitude, with ties broken by a configurable tie-break strategy using `opts.seed`.

#### Scenario: Exact division produces no remainder
- **WHEN** exact shares sum to the amount exactly after truncation
- **THEN** `distributeRemainder` returns the truncated shares without modification

#### Scenario: Positive remainder distributed by fractional part
- **WHEN** the amount is 100 cents split EVENLY among 3 participants
- **THEN** `distributeRemainder` produces shares summing to exactly 100 (e.g., 33/33/34) with the extra cent assigned to the participant with the largest fractional part

#### Scenario: Negative amount (refund) truncates toward zero
- **WHEN** the amount is -101 cents split EVENLY among 3 participants
- **THEN** `distributeRemainder` produces shares summing to exactly -101 (e.g., -33/-34/-34) using `ceil` for negative values

#### Scenario: BY_AMOUNT mismatch gives remainder to payer
- **WHEN** BY_AMOUNT shares sum to less than the amount and `opts.payerId` is set
- **THEN** `distributeRemainder` gives the entire difference to the payer

### Requirement: Expense-id-seeded tie-break
The system SHALL break ties in remainder distribution using an expense-id-seeded offset. When multiple participants have equal fractional parts, they SHALL be sorted by fractional part descending then by participant ID ascending, and the starting offset SHALL be `seed % tiedCount`. For per-expense distribution, `seed` SHALL be a stable hash of `expense.id` (FNV-1a), or `0` when `id` is missing/empty (create/preview paths). For global balance distribution, `seed` SHALL be 0. The tie-break strategy SHALL be designed as a configurable interface supporting future strategies (`PARTICIPANT_ID_DESC`, `ROUND_ROBIN`, `RANDOM_SEEDED`). Default strategy is `EXPENSE_ID_SEEDED`.

#### Scenario: Same fractional parts on different expense ids
- **WHEN** two expenses with different ids each have a 1-cent tie among the same 3 participants
- **THEN** the participant absorbing the extra cent may differ based on the id-derived seed

#### Scenario: Same expense id produces deterministic result
- **WHEN** the same expense is processed multiple times
- **THEN** the same participant absorbs the extra cent every time

#### Scenario: Missing expense id falls back to seed 0
- **WHEN** `calculateShares` or `computePaidForFromItems` is called without an expense id
- **THEN** the seed is 0 (same as global balance distribution)

#### Scenario: Global balance distribution uses seed 0
- **WHEN** `getBalances` distributes the global leftover across all expenses
- **THEN** the seed is 0 and ties are broken by participant ID ascending

### Requirement: Per-expense integer share calculation
The system SHALL provide `calculateShares(expense)` that returns `Record<participantId, number>` (integer cents) by calling `distributeRemainder(calculateExactShares(input), expense.amount, { seed: expenseIdSeed(expense.id), payerId })`. The `payerId` SHALL be set only when `splitMode` is BY_AMOUNT or ITEMIZED. The sum of returned shares SHALL equal `expense.amount` exactly.

#### Scenario: Per-expense shares sum to amount
- **WHEN** `calculateShares` is called for any expense
- **THEN** the sum of all participant shares equals the expense amount exactly

#### Scenario: Form preview matches per-expense distribution
- **WHEN** the expense form calls `calculateShare(participantId, expense)` for preview
- **THEN** it delegates to `calculateShares(expense)[participantId]` and returns the per-expense integer cent value

### Requirement: Per-participant share delegates
The system SHALL provide `calculateShare(participantId, expense)` and `calculatePaidByShare(participantId, expense)` as thin delegates that call `calculateShares(expense)` and `calculatePaidByShares(expense)` respectively and return the named participant's share (or 0 if not found). These SHALL NOT contain independent calculation logic.

#### Scenario: CalculateShare delegates to calculateShares
- **WHEN** `calculateShare('p1', expense)` is called
- **THEN** it returns `calculateShares(expense)['p1'] ?? 0`

#### Scenario: CalculatePaidByShare delegates to calculatePaidByShares
- **WHEN** `calculatePaidByShare('p1', expense)` is called
- **THEN** it returns `calculatePaidByShares(expense)['p1'] ?? 0`

### Requirement: Fixed-point BY_SHARES storage units
The system SHALL store BY_SHARES weights as fixed units where one displayed share equals 100 stored units: `display share × 100 = stored fixed units` (`0.5 → 50`, `1 → 100`, `1.1 → 110`). Displayed shares SHALL accept at most two decimal places in the range 0.01 to 1,000,000 (inclusive), and stored units SHALL be integers in the range 1 to 100,000,000 (inclusive). The conversion SHALL be applied on the write side to expense paidFor, expense paidBy, item paidFor, itemized-remainder paidFor, and saved default-split paidFor rows.

#### Scenario: Display share converts to fixed units
- **WHEN** a user enters displayed shares `0.5`, `1`, and `1.1` in a BY_SHARES split
- **THEN** the serialized storage units are `50`, `100`, and `110`

#### Scenario: Item and remainder rows use the same fixed units
- **WHEN** a BY_SHARES item paidFor row or itemized-remainder paidFor row is serialized
- **THEN** it converts with the same `display share × 100` rule as expense-level rows

#### Scenario: Fixed units are not currency-converted
- **WHEN** a BY_SHARES expense crosses currencies
- **THEN** the stored fixed units are used as unitless weights and are never multiplied by a conversion rate

### Requirement: Write-side share serializers
The system SHALL provide `serializePaidFor({ splitMode, paidFor, amount, currency, conversionRate? })` and `serializePaidBy({ paidBySplitMode, paidByList, amount, inputCurrency, conversionRate? })` domain helpers that convert user-entered share values to storage units. BY_AMOUNT SHALL convert via `amountAsMinorUnits(shares * rate, currency)`; BY_PERCENTAGE SHALL produce basis points via `Math.round(shares * 100)`; BY_SHARES SHALL produce fixed units via the `display share × 100` rule; EVENLY rows SHALL be left untouched so inclusion markers do not become valid weights. These helpers SHALL NOT distribute remainders.

#### Scenario: BY_AMOUNT serialization converts to minor units
- **WHEN** `serializePaidFor` is called with `splitMode: 'BY_AMOUNT'` and shares in major units
- **THEN** it converts each share to minor units using the specified currency and conversion rate

#### Scenario: BY_PERCENTAGE serialization converts to basis points
- **WHEN** `serializePaidFor` is called with `splitMode: 'BY_PERCENTAGE'` and shares as percentages
- **THEN** it converts each share to basis points via `Math.round(shares * 100)`

#### Scenario: BY_SHARES serialization converts to fixed units
- **WHEN** `serializePaidFor` is called with `splitMode: 'BY_SHARES'` and displayed shares such as `0.5` or `1.1`
- **THEN** it stores fixed units `50` and `110` — the shared `display share × 100` rule, never `Math.round(shares)` of the raw display value

#### Scenario: Serializer works for both expense and item paidFor
- **WHEN** the same `serializePaidFor` is called for an expense-level paidFor or an item-level paidFor
- **THEN** it produces the correct storage units in both cases since both share the same input shape

### Requirement: Cross-currency serializer convention
The serializers SHALL follow a consistent cross-currency convention: `serializePaidFor` with `conversionRate` SHALL convert BY_AMOUNT shares from original to ledger currency (`amountAsMinorUnits(shares * rate, ledgerCurrency)`); BY_PERCENTAGE, BY_SHARES, and EVENLY shares are unitless and SHALL NOT be converted. `serializePaidBy` with `conversionRate` SHALL keep BY_AMOUNT shares in **original currency** (`amountAsMinorUnits(shares, originalCurrency)`) so that `getBalances` can apply `conversionRate` at read time; BY_PERCENTAGE, BY_SHARES, and EVENLY shares are unitless and SHALL NOT be converted. The converted `amount` SHALL be computed separately via `convertByRate` from the native `exact-math` module (BigInt-based rational) then `distributeRemainder`.

> **Acceptable imprecision**: Since all amounts are integer cents, `convertByRate` uses `Math.round(Number(rational) * Number(rate))` which may introduce sub-cent floating-point noise but always rounds to the nearest integer cent. This is intentionally accepted — the dependency on `decimal.js` was removed because exact rational arithmetic up to the truncation point provides sufficient precision for cent-based accounting.

#### Scenario: serializePaidFor converts BY_AMOUNT to ledger currency
- **WHEN** `serializePaidFor` is called with `splitMode: 'BY_AMOUNT'`, `conversionRate: 0.92`, and shares in original currency
- **THEN** each share is converted to ledger currency minor units via `amountAsMinorUnits(shares * 0.92, ledgerCurrency)`

#### Scenario: serializePaidFor does not convert unitless shares
- **WHEN** `serializePaidFor` is called with `splitMode: 'BY_PERCENTAGE'` or `'BY_SHARES'` or `'EVENLY'` and `conversionRate` set
- **THEN** the shares are not multiplied by the conversion rate; they remain unitless weights or basis points

#### Scenario: serializePaidBy keeps BY_AMOUNT in original currency
- **WHEN** `serializePaidBy` is called with `paidBySplitMode: 'BY_AMOUNT'`, `conversionRate: 0.92`, and shares in original currency
- **THEN** each share is stored in original currency minor units via `amountAsMinorUnits(shares, originalCurrency)` — NOT multiplied by the conversion rate

#### Scenario: Converted amount uses native exact rational arithmetic
- **WHEN** the converted ledger `amount` is computed for a cross-currency expense
- **THEN** it uses `convertByRate(exactFromInteger(originalAmount), conversionRate)` from the native `exact-math` module and `distributeRemainder` for truncation, not `Math.round(amount * rate)`
