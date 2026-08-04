## Purpose

Defines the ledger accounting core: one Ledger per group with a base currency, the storage units for every split mode (including fixed-point BY_SHARES weights), exact balance accumulation, and the transactional migration that converted legacy share weights to fixed units.

## Requirements

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
The system SHALL store base currency on the Ledger and SHALL store expense amounts in ledger-currency minor units (integer minor units of the ledger currency — typically cents for fiat, but the same field holds minor units for crypto ledgers per catalog `decimal_digits`). For converted expenses, the system SHALL compute the ledger-currency total server-side from original/input currency values and the source-resolved conversion rate. Original amount, shares, and items SHALL remain in the expense original/input currency.

#### Scenario: Expense in ledger currency
- **WHEN** an expense is entered in the Ledger base currency
- **THEN** the system stores null `conversionSource`, stores the amount in ledger minor units, and does not require exchange or custom conversion metadata

#### Scenario: Expense in different currency with exchange rate
- **WHEN** an expense is entered in a different supported catalog currency than the Ledger base and `conversionSource` is `EXCHANGE`
- **THEN** the system resolves the rate server-side (Frankfurter for fiat legs, Coinbase for crypto legs, with bridging when needed), stores the server-normalized ledger-currency total, and preserves original amount, original currency, `conversionSource`, and conversion rate

#### Scenario: Expense in different currency with custom rate
- **WHEN** an expense is entered in a currency different from the Ledger base and `conversionSource` is `CUSTOM`
- **THEN** the system accepts a positive user-supplied rate, computes the ledger-currency total server-side, and preserves original amount, original currency, `conversionSource`, and conversion rate

#### Scenario: Client conversion is preview-only
- **WHEN** the client submits an expense that requires conversion
- **THEN** the system does not treat client-provided ledger totals as authoritative and computes persisted ledger values on the server from original/input values and the source-resolved rate

#### Scenario: Direct ledger base currency
- **WHEN** a user creates a direct Ledger
- **THEN** the system suggests a base currency from account preference or locale and allows the user to choose a different base currency (supported catalog fiat or crypto, or custom)

### Requirement: Conversion source
The system SHALL persist `conversionSource` on each expense: `EXCHANGE` or `CUSTOM` (null when same currency). Users SHALL be able to choose and later change the source when the expense currency differs from the ledger base (subject to currency/provider constraints). The exchange option SHALL show provider attribution (Frankfurter and Coinbase with API links) as defined in the currency-exchange spec.

#### Scenario: Same-currency forces none
- **WHEN** the selected expense currency equals the Ledger base currency
- **THEN** the system stores null `conversionSource` and does not store a conversion rate

#### Scenario: Exchange source requires supported pair
- **WHEN** `conversionSource` is `EXCHANGE`
- **THEN** both expense currency and Ledger base currency are supported catalog codes the exchange service can price (including crypto via Coinbase and fiat via Frankfurter, with bridging); otherwise the system rejects the save

#### Scenario: Custom currency requires custom rate when converted
- **WHEN** an expense currency or Ledger base currency is custom/unsupported for exchange and the two differ
- **THEN** the system requires `conversionSource` `CUSTOM` and a positive custom rate

### Requirement: Existing split units
The system SHALL store split units as follows: BY_AMOUNT in ledger-currency minor units, BY_PERCENTAGE in basis points out of 10000, EVENLY as equal participation, and BY_SHARES as positive integer hundredths of a share where `100 = 1 displayed share` (`0.5` displays as stored `50`, `1.1` displays as stored `110`). The fixed share units SHALL apply to expense paidFor rows, expense paidBy rows, item paidFor rows, itemized-remainder paidFor rows, and saved default-split paidFor rows.

#### Scenario: Percentage split
- **WHEN** a percentage split is saved
- **THEN** the paid-for shares sum to 10000 basis points

#### Scenario: Amount split
- **WHEN** an amount split is saved
- **THEN** the paid-for shares are stored in Ledger base-currency minor units

#### Scenario: Share split stores fixed units
- **WHEN** a BY_SHARES split is saved with displayed shares
- **THEN** the paid-for shares are stored as integer hundredths (`1.1` -> `110`, `0.5` -> `50`) with `100` equal to one displayed share

#### Scenario: Saved default split uses fixed units
- **WHEN** a user's saved default split uses BY_SHARES
- **THEN** its paid-for rows are stored in the same fixed units (`100 = 1 displayed share`)

### Requirement: Fixed-point share migration
The system SHALL migrate legacy relative share weights to fixed units in a single transactional migration that multiplies stored shares by 100 only for rows owned by a BY_SHARES mode: expense paidFor rows whose expense `splitMode` is BY_SHARES, paidBy rows whose `paidBySplitMode` is BY_SHARES, item paidFor rows whose item `splitMode` is BY_SHARES, itemized-remainder paidFor rows whose remainder `splitMode` is BY_SHARES, saved default-split paidFor rows whose `splitMode` is BY_SHARES, and the matching recurring-template JSONB share paths. Rows owned by other modes SHALL be left unchanged. The migration SHALL run a preflight overflow check and abort (rolling back the whole transaction) if any BY_SHARES value exceeds the pre-migration integer bound, and it SHALL preserve allocation ratios because every weight in a split is scaled by the same constant.

#### Scenario: BY_SHARES rows scale by 100 exactly once
- **WHEN** a legacy expense has `splitMode = BY_SHARES` with stored weights
- **THEN** its paidFor, paidBy, item, remainder, and default-split weights are multiplied by 100 in the migration and are never scaled again

#### Scenario: Non-share modes stay unchanged
- **WHEN** a row is owned by BY_AMOUNT, BY_PERCENTAGE, EVENLY, or ITEMIZED
- **THEN** the migration does not touch its stored shares, and no later code path rescales it

#### Scenario: Overflow aborts the migration
- **WHEN** any BY_SHARES row or template path would exceed the pre-migration integer bound after scaling
- **THEN** the migration raises an exception and the transaction rolls back, preserving the legacy schema

#### Scenario: Ratios survive the scale
- **WHEN** a BY_SHARES split with weights `1` and `3` is migrated
- **THEN** the stored units are `100` and `300`, and the proportional allocation `1:3` is identical before and after migration

### Requirement: Global balance accumulation
The system SHALL compute balances by accumulating exact `ExactAmount` (native `BigInt` rational) shares across all expenses per direction (paid and paidFor) into per-participant `ExactAmount` maps, applying cross-currency conversion via `convertByRate` per-expense, then truncating + distributing the single global leftover once via `distributeRemainder`. The sum of all participant `paidFor` values SHALL exactly equal the sum of all expense amounts. The sum of all participant `paid` values SHALL exactly equal the sum of all expense amounts.

> **Currency conversion precision**: All amounts are integer minor units of the ledger or expense currency. `convertByRate` converts exact rational shares using the persisted rate; fractional noise is absorbed by `distributeRemainder` so ledger totals remain exact integers.

#### Scenario: Cross-expense drift eliminated
- **WHEN** two expenses of $100 and $20 are each split EVENLY among 3 participants
- **THEN** the cumulative `paidFor` per participant is exactly 4000/4000/4000 (not 3999/4000/4001)

#### Scenario: Single expense global distribution
- **WHEN** a single $100 expense is split EVENLY among 3 participants
- **THEN** `getBalances` produces `paidFor` values of 3333/3333/3334 summing to exactly 10000

#### Scenario: Cross-currency conversion at native exact rational precision
- **WHEN** an expense is paid in a foreign currency with `originalCurrency` and `conversionRate`
- **THEN** the paidBy side accumulates `convertByRate(exactShare, conversionRate)` per-expense, and the global `distributeRemainder` absorbs any conversion rounding drift

#### Scenario: Balance sum invariant
- **WHEN** `getBalances` is called with any set of expenses
- **THEN** `Σ balances[id].paidFor === Σ expense.amount` and `Σ balances[id].paid === Σ expense.amount` exactly

#### Scenario: ITEMIZED cross-currency treated as BY_SHARES
- **WHEN** an ITEMIZED expense has `originalCurrency` and `conversionRate` and persisted `paidFor.shares` in original-currency cents
- **THEN** `getBalances` treats the shares as BY_SHARES weights against the ledger `expense.amount` and distributes proportionally

### Requirement: Balance engine delegates to share-calculation core
The `getBalances` function SHALL use `calculateExactShares` from the `share-calculation` core for both the paidBy and paidFor sides of each expense. It SHALL NOT contain independent per-mode split math. The `isLast = remaining` idiom and `Math.round` on accumulators SHALL be removed.

#### Scenario: getBalances calls calculateExactShares for paidFor
- **WHEN** `getBalances` processes an expense's paidFor side
- **THEN** it calls `calculateExactShares({ amount, splitMode, participants })` and accumulates the `ExactAmount` result

#### Scenario: getBalances calls calculateExactShares for paidBy
- **WHEN** `getBalances` processes an expense's paidBy side
- **THEN** it calls `calculateExactShares` with the payer base and `paidBySplitMode`, applies cross-currency conversion if needed, and accumulates the `ExactAmount` result

#### Scenario: No Math.round on accumulators
- **WHEN** `getBalances` finalizes balances
- **THEN** no `Math.round` is applied to accumulated values because `distributeRemainder` already returns exact integers

### Requirement: Effective expense currency resolves to ledger base when no original currency
The system SHALL resolve an expense's effective currency to `originalCurrency` when present and otherwise to the group Ledger base currency, so cross-currency recommendation ranking aligns with the Ledger base currency. (The full common-currency ranking algorithm lives in the expenses spec.)

#### Scenario: Expense with original currency
- **WHEN** an expense stores an `originalCurrency`
- **THEN** its effective currency is that `originalCurrency`

#### Scenario: Expense in ledger currency only
- **WHEN** an expense has no `originalCurrency`
- **THEN** its effective currency is the Ledger base currency
