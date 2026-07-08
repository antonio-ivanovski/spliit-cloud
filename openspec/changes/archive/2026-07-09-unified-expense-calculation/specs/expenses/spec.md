## ADDED Requirements

### Requirement: Expense calculation uses unified core
All expense-side share calculation — form preview, CSV export, and totals — SHALL route through the `share-calculation` core (`calculateShares` / `calculatePaidByShares`). The form `submit-values.ts` SHALL use `serializePaidFor` / `serializePaidBy` from the `share-calculation` core instead of inline per-mode conversion math.

#### Scenario: Form preview uses calculateShares
- **WHEN** the expense form renders per-participant share previews in `paid-for-row.tsx` or `paid-by-row.tsx`
- **THEN** it calls `calculateShare` / `calculatePaidByShare` which delegate to `calculateShares` / `calculatePaidByShares` from the unified core

#### Scenario: Form submission uses serializePaidFor
- **WHEN** the expense form serializes paidFor shares for API submission
- **THEN** it calls `serializePaidFor` from the `share-calculation` core and contains no inline per-mode conversion math

#### Scenario: Total active user share delegates to getBalances
- **WHEN** `getTotalActiveUserShare` or `getTotalActiveUserPaidFor` is called
- **THEN** it delegates to `getBalances(expenses.filter(e => !e.isReimbursement))` and returns the named participant's `paidFor` or `paid` value respectively

### Requirement: ITEMIZED aggregation uses global-across-items accumulation
The system SHALL compute ITEMIZED expense `paidFor` shares by accumulating exact Decimal shares across all items and the "Other" filler, then truncating + distributing the single leftover once via `distributeRemainder`. This eliminates cross-item cent drift. Per-item modal preview SHALL retain per-item rounding (each item independently balances to its own amount for display).

#### Scenario: Multiple items with fractional remainders aggregate globally
- **WHEN** an ITEMIZED expense has two $50 items each split EVENLY among 3 participants
- **THEN** the aggregated `paidFor` shares are computed by accumulating exact Decimal shares across both items and distributing the single leftover once (e.g., 3333/3333/3334 rather than 3332/3334/3334)

#### Scenario: Per-item modal preview retains per-item rounding
- **WHEN** the item participants modal shows per-participant shares for a single item
- **THEN** it shows per-item integer cents that sum to the item's amount (per-item distribution), which may differ from the aggregated total by at most 1 cent

#### Scenario: Filler participates in global accumulation
- **WHEN** items sum to less than the expense amount and a synthetic "Other" filler is created
- **THEN** the filler's exact Decimal shares are accumulated into the same per-participant map before the single global distribution
