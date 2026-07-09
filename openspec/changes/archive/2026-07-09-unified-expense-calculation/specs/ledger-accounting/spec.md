## ADDED Requirements

### Requirement: Global balance accumulation
The system SHALL compute balances by accumulating exact Decimal shares across all expenses per direction (paid and paidFor) into per-participant Decimal maps, applying cross-currency conversion at Decimal precision per-expense, then truncating + distributing the single global leftover once via `distributeRemainder`. The sum of all participant `paidFor` values SHALL exactly equal the sum of all expense amounts. The sum of all participant `paid` values SHALL exactly equal the sum of all expense amounts.

#### Scenario: Cross-expense drift eliminated
- **WHEN** two expenses of $100 and $20 are each split EVENLY among 3 participants
- **THEN** the cumulative `paidFor` per participant is exactly 4000/4000/4000 (not 3999/4000/4001)

#### Scenario: Single expense global distribution
- **WHEN** a single $100 expense is split EVENLY among 3 participants
- **THEN** `getBalances` produces `paidFor` values of 3333/3333/3334 summing to exactly 10000

#### Scenario: Cross-currency conversion at Decimal precision
- **WHEN** an expense is paid in a foreign currency with `originalCurrency` and `conversionRate`
- **THEN** the paidBy side accumulates `Decimal(exactShare).mul(conversionRate)` per-expense without `Math.round`, and the global `distributeRemainder` absorbs any conversion rounding drift

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
- **THEN** it calls `calculateExactShares({ amount, splitMode, participants })` and accumulates the Decimal result

#### Scenario: getBalances calls calculateExactShares for paidBy
- **WHEN** `getBalances` processes an expense's paidBy side
- **THEN** it calls `calculateExactShares` with the payer base and `paidBySplitMode`, applies cross-currency conversion if needed, and accumulates the Decimal result

#### Scenario: No Math.round on accumulators
- **WHEN** `getBalances` finalizes balances
- **THEN** no `Math.round` is applied to accumulated values because `distributeRemainder` already returns exact integers
