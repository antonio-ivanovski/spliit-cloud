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

> **Currency conversion precision**: All money is integer cents. `convertByRate` converts exact rational shares to cents via `Math.round(Number(rational) * Number(rate))`. The `decimal.js` dependency has been removed — native `BigInt` rational arithmetic is used instead, and sub-cent floating-point noise in the rate multiplication is accepted because the result is always rounded to the nearest integer cent.

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
