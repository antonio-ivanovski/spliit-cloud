## Why

Expense share calculation is fragmented across four independent implementations (`getBalances`, `calculateShare`, `computePaidForFromItems`, and inline import math) that use plain JavaScript floats with independent rounding. This causes two classes of bugs: (1) per-expense cent loss — when an amount doesn't divide cleanly (e.g., $1.00 ÷ 3), each share truncates to 33.33¢ and the missing cent disappears; (2) cross-expense cent drift — when multiple expenses with indivisible splits accumulate, per-expense rounding compounds so $100 + $20 split evenly among 3 should total 4000/4000/4000 but per-expense distribution yields 3999/4000/4001. The same drift exists within ITEMIZED expenses across items. Upstream PR #462 proposes per-expense fractional-part distribution, but that systematically biases the same participant on every expense, worsening cumulative drift.

## What Changes

- Introduce `calculateExactShares(input)` as the single `decimal.js`-based core that computes exact (non-truncated) per-participant shares. It accepts a shape-based input (`{ amount, splitMode, participants }`) that works identically for expenses, expense items, and the payer side — no duplication.
- Introduce `distributeRemainder(exactShares, amount, opts)` as the single truncation + remainder distribution algorithm. Truncates toward zero, distributes leftover cents by descending fractional-part magnitude, ties broken by an expense-id-seeded offset (stable hash of expense id; fair across expenses, deterministic per expense; seed 0 when id missing). Works at any granularity: per-item, per-expense, or globally across all expenses.
- Rewrite `getBalances(expenses)` to accumulate exact Decimal shares across ALL expenses per direction (paid/paidFor), apply cross-currency conversion at Decimal precision per-expense, then truncate + distribute the single global leftover once. Guarantees `Σ paidFor === Σ amount` exactly.
- Rewrite `computePaidForFromItems` to accumulate exact Decimal shares across all items + the "Other" filler, then truncate + distribute once — eliminating cross-item drift. Per-item modal preview keeps per-item rounding (each item independently balances to its own amount for display).
- Introduce `serializePaidFor`/`serializePaidBy` domain helpers that replace all inline cent math in the form (`submit-values.ts`) and importers (`spliit-csv.ts`, `splitwise-csv.ts`, `batch.ts`).
- Make `calculateShare`/`calculatePaidByShare` thin delegates to `calculateShares`/`calculatePaidByShares`. Make `getTotalActiveUserShare`/`getTotalActiveUserPaidFor` delegate to `getBalances` so displayed totals exactly match the balance sheet.
- Rewrite CSV export (`apps/api/src/routes/export-csv.ts`) to use `calculateShares` per expense.
- **BREAKING**: Drop `distributeEvenly`, `distributeWeighted`, `parseFloat(toFixed(2))`, `Math.round` on balance accumulators, the `isLast = remaining` idiom, and all inline drift correctors in importers. BY_AMOUNT shares are treated as literal cents (not weights) in `getBalances`, aligning with `calculateShare` and `itemized-expenses.ts`. Cumulative balances will shift by ≤2¢ for groups with multiple fractional-split expenses — the intended accuracy fix.
- The tie-break strategy is designed as a configurable interface (strategy enum + seed) with `EXPENSE_ID_SEEDED` as the default. Per-group/instance configuration is deferred.

## Capabilities

### New Capabilities

- `share-calculation`: Unified per-participant share math core (`calculateExactShares`, `distributeRemainder`, `calculateShares`, `serializePaidFor`/`serializePaidBy`) covering all split modes (EVENLY, BY_SHARES, BY_PERCENTAGE, BY_AMOUNT, ITEMIZED), cross-currency conversion, and expense-id-seeded remainder tie-break. Applies to expenses, expense items, and global balance accumulation.

### Modified Capabilities

- `expenses`: All expense-side calculation (form preview, CSV export, write-side serialization) routes through the unified `share-calculation` core. ITEMIZED aggregation uses global-across-items accumulation. BY_AMOUNT shares are literal cents, not weights.
- `ledger-accounting`: Balance computation (`getBalances`) accumulates exact Decimal shares across all expenses with a single global remainder distribution, guaranteeing `Σ paidFor === Σ amount` and `Σ paid === Σ amount` exactly.
- `spliit-import`: Inline drift correctors in `spliit-csv.ts` and `batch.ts` replaced by `share-calculation` helpers.
- `splitwise-import`: Inline `Math.floor` + `+= 1` distribution loop in `splitwise-csv.ts` replaced by `share-calculation` helpers.
- `exports`: CSV export per-participant share computation replaced by `calculateShares` from the `share-calculation` core.

## Impact

- **Domain** (`packages/domain/src/`): rewrite `totals.ts` (new `calculateExactShares`, `distributeRemainder`, `calculateShares`, `calculatePaidByShares`, `serializePaidFor`, `serializePaidBy`), rewrite `balances.ts` (`getBalances` global accumulation), rewrite `itemized-expenses.ts` (global-across-items accumulation, drop `distributeEvenly`/`distributeWeighted`), update `import/` files (drop inline correctors).
- **Web** (`apps/web/src/`): replace `submit-values.ts` inline math with domain helpers; form preview (`paid-for-row.tsx`, `paid-by-row.tsx`, `item-participants-modal.tsx`) auto-benefits from delegating `calculateShare`/`calculatePaidByShare`.
- **API** (`apps/api/src/`): CSV export route uses `calculateShares`; settlement unchanged (already flows through `getBalances`); expense persistence unchanged (serializers are the gate).
- **Tests**: update ~8 existing assertions to new distribution rule; add global-accumulation, tie-break, per-expense, cross-item, write-side, and import-drift coverage.
- **Dependencies**: `decimal.js` already in `packages/domain` and `apps/web` — no new deps.
- **Behavioral change**: cumulative balances shift ≤2¢ for groups with multiple fractional-split expenses. Per-expense display shares use expense-id-seeded tie-break instead of last-participant absorption.
