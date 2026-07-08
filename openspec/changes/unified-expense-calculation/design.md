## Context

Spliit's expense share calculation is currently implemented in four independent places using plain JavaScript floats:

1. `getBalances` (`packages/domain/src/balances.ts`) — the balance engine. Accumulates per-expense float shares into a per-participant map, rounds once at the end with `Math.round`.
2. `calculateShare` / `calculatePaidByShare` (`packages/domain/src/totals.ts`) — per-expense per-participant helpers used by the form preview and totals. Returns unrounded floats.
3. `computePaidForFromItems` (`packages/domain/src/itemized-expenses.ts`) — ITEMIZED aggregation. Uses `distributeEvenly` / `distributeWeighted` with per-item last-participant remainder absorption.
4. Inline import math (`spliit-csv.ts`, `splitwise-csv.ts`, `batch.ts`) — each has its own drift corrector.

All money is integer cents (minor units). `BY_PERCENTAGE` shares are basis points (out of 10000). `decimal.js` is already a dependency in `packages/domain` and `apps/web` but is not currently used for share calculation.

The fork has three features upstream PR #462 does not address: multi-payer (`paidByList` array), cross-currency (`originalCurrency` / `conversionRate`), and ITEMIZED split mode.

## Goals / Non-Goals

**Goals:**

- One `calculateExactShares` function that works for expenses, expense items, and the payer side — shape-based, not entity-based. No duplication.
- One `distributeRemainder` function that works at any granularity (per-item, per-expense, global across all expenses).
- `getBalances` accumulates exact Decimal shares across all expenses, truncates + distributes once. Guarantees `Σ paidFor === Σ amount` exactly.
- `computePaidForFromItems` accumulates exact Decimal across all items + filler, truncates once. Eliminates cross-item drift.
- Expense-id-seeded tie-break for remainder distribution (fair across expenses, deterministic per expense, configurable interface for future per-group config).
- All write-side paths (form, import) route through domain serializers. No inline cent math.
- Trust stored `amount` as the ledger-currency source of truth.

**Non-Goals:**

- Per-group or per-instance tie-break configuration (interface designed for it, but deferred).
- Re-deriving `amount` from `originalAmount * conversionRate` at read time (trust stored `amount`).
- Changing the persisted share shape per split mode (weights for EVENLY/BY_SHARES, BPS for BY_PERCENTAGE, cents for BY_AMOUNT/ITEMIZED).
- Changing the `getSuggestedReimbursements` or `getPublicBalances` algorithms (they only consume final `total` per participant — transparent to the refactor).
- Changing settlement row shape (already exact for single-payer/single-owee).

## Decisions

### Shape-based core for expenses and items

The core `calculateExactShares` accepts a minimal shape that both expenses and items share:

```
type SplitInput = {
  amount: number          // minor units (cents)
  splitMode: SplitMode
  participants: Array<{ id: string; shares: number }>
}
```

This shape is identical for:
- An expense's paidFor side: `{ amount: expense.amount, splitMode: expense.splitMode, participants: expense.paidFor }`
- An expense's paidBy side: `{ amount: payerBase, splitMode: expense.paidBySplitMode, participants: expense.paidByList }`
- An item: `{ amount: item.amount, splitMode: item.splitMode, participants: item.paidFor }`

Alternative considered: separate `calculateExpenseShares` / `calculateItemShares` functions. Rejected — they'd contain identical math, violating the "no duplication" goal. The shape-based approach makes the item/expense distinction a caller responsibility (adapting the entity to the shared shape), keeping the core pure.

### Two-tier: exact core + distribution

`calculateExactShares` returns `Record<participantId, Decimal>` — exact, non-truncated. `distributeRemainder` truncates toward zero and distributes leftover cents. This separation allows:

- **Per-expense display** (`calculateShares`): `distributeRemainder(calculateExactShares(expense), expense.amount, { seed, payerId })` — per-expense integer cents for form preview, CSV export.
- **Global balances** (`getBalances`): accumulate `calculateExactShares` results across all expenses into Decimal maps, then `distributeRemainder(globalMap, totalAmount)` once — zero cross-expense drift.
- **Item aggregation** (`computePaidForFromItems`): accumulate `calculateExactShares` results across all items into a Decimal map, then `distributeRemainder` once — zero cross-item drift.

Alternative considered: single `calculateShares` that always returns integers per-expense, with `getBalances` summing integers. Rejected — this is exactly the current approach and it causes cross-expense drift ($100+$20÷3 → 3999/4000/4001 instead of 4000/4000/4000). The two-tier design lets the balance engine defer truncation to the global level.

### Global accumulation in `getBalances`

```
function getBalances(expenses):
  globalPaid = {}    // Record<id, Decimal>
  globalPaidFor = {} // Record<id, Decimal>

  for each expense:
    // PaidBy side (may be cross-currency)
    payerBase = isCrossCurrency ? originalAmount : amount
    exactPaidBy = calculateExactShares({ amount: payerBase, splitMode: paidBySplitMode, participants: paidByList })
    if isCrossCurrency:
      for id in exactPaidBy: exactPaidBy[id] = exactPaidBy[id].mul(conversionRate)

    // PaidFor side (always ledger currency)
    paidForSplitMode = (splitMode === ITEMIZED && isCrossCurrency) ? BY_SHARES : splitMode
    exactPaidFor = calculateExactShares({ amount: expense.amount, splitMode: paidForSplitMode, participants: paidFor })

    // Accumulate
    for id in exactPaidBy:  globalPaid[id]   += exactPaidBy[id]
    for id in exactPaidFor: globalPaidFor[id] += exactPaidFor[id]

  totalAmount = Σ expense.amount
  paid    = distributeRemainder(globalPaid, totalAmount, { seed: 0 })
  paidFor = distributeRemainder(globalPaidFor, totalAmount, { seed: 0 })

  for each id: balances[id] = { paid, paidFor, total: paid - paidFor }
  return balances
```

For ITEMIZED cross-currency, the persisted `paidFor.shares` are in original currency. `getBalances` treats them as BY_SHARES weights against the ledger `expense.amount` (current behavior, preserved). For non-cross-currency ITEMIZED, shares are exact ledger cents (BY_AMOUNT semantic).

Alternative considered: per-expense `distributeRemainder` then sum integers. Rejected — this is the current approach and causes cross-expense drift. The global approach guarantees `Σ paidFor === Σ amount` exactly.

### Expense-id-seeded tie-break

When fractional parts tie, the seed determines which tied participant gets the leftover cent first:

```
tiedParticipants = sorted by fractional part desc, then by ID asc
offset = seed % tiedParticipants.length
distribute cents starting from tiedParticipants[offset], wrapping around
```

For per-expense `calculateShares` / `calculatePaidByShares` / `computePaidForFromItems`, `seed = expenseIdSeed(expense.id)` — a stable FNV-1a hash of the expense id. Missing/empty id → `0` (create/preview). Different expense ids → different participants absorb the cent → fair across expenses. Same id → same result → deterministic.

`expenseDate` is `@db.Date` (UTC midnight only). Using `expenseDate.getTime()` as seed was rejected: day steps are multiples of 86_400_000 ms, so `seed % 3` (and other common group sizes) never rotated.

For global `getBalances`, `seed = 0` (global accumulation already minimizes ties since most fractional parts cancel across expenses).

The tie-break strategy is designed as a configurable interface:

```
type TieBreakStrategy = 'EXPENSE_ID_SEEDED' | 'PARTICIPANT_ID_DESC' | 'ROUND_ROBIN' | 'RANDOM_SEEDED'
```

`EXPENSE_ID_SEEDED` is the default. Per-group/instance configuration is deferred but the interface is ready.

Alternative considered: always use participant ID descending (simplest). Rejected — biases the same participant on every expense with a tie. The expense-id-seeded approach distributes the bias fairly across expenses.

Alternative considered: expense-date ms seed. Rejected — `@db.Date` makes timestamps day-aligned, so common `seed % N` offsets are stuck at 0.

Alternative considered: `ROUND_ROBIN` with a global counter. Rejected — requires stateful tracking across expenses; the id-based seed is stateless and deterministic.

### BY_AMOUNT literal semantic

BY_AMOUNT shares are exact cents. If they don't sum to `amount`, `distributeRemainder` gives the diff to the payer (when `opts.payerId` is set). This aligns `getBalances` with `calculateShare` (which already returns `shares` literally for BY_AMOUNT) and with `itemized-expenses.ts` (which stores exact cents).

The current `getBalances` treats BY_AMOUNT shares as weights (`(amount * shares) / totalShares`), which is inconsistent. The refactor switches to literal.

For the `payerId` fallback: it's only set for per-expense `calculateShares` when `splitMode` is BY_AMOUNT or ITEMIZED. For global `getBalances` distribution, `payerId` is not set — the fractional-part rule applies.

Alternative considered: keep BY_AMOUNT as weights in `getBalances`. Rejected — it's the source of the "101 split as 10/10/10 → 34/34/34" behavior that conflicts with `calculateShare`'s literal `return shares`. The literal semantic is what users see in the form and what issue #374's original proposal suggests.

### ITEMIZED global-across-items accumulation

`computePaidForFromItems` loops items, calls `calculateExactShares` on each item's `{ amount, splitMode, participants }`, accumulates into a per-participant Decimal map (including the "Other" filler), then `distributeRemainder` once.

The per-item modal preview keeps per-item rounding (each item independently balances to its own `amount` for display). The sum of per-item previews may differ from the aggregated total by ≤1¢ — this is the intended trade-off: the aggregated ledger shares are fairer, the per-item display is honest about each item's own split.

Alternative considered: keep per-item distribution. Rejected — it causes cross-item drift (N evenly-split items over-credit the last participant by N cents, compounding across expenses). The global-across-items approach is the same fix as cross-expense global accumulation, applied one level down.

Alternative considered: make per-item preview match the aggregated total. Rejected — each item must independently balance to its own amount for display (that's the point of itemized mode). The ≤1¢ mismatch is acceptable and expected.

### Write-side serializers

`serializePaidFor({ splitMode, paidFor, amount, currency, conversionRate? })` and `serializePaidBy(...)` replace inline form/import math:

| Split mode | Transform |
|---|---|
| BY_AMOUNT | `amountAsMinorUnits(conversionRequired ? shares * rate : shares, currency)` |
| BY_PERCENTAGE | `Math.round(shares * 100)` |
| EVENLY / BY_SHARES | `Math.round(shares)` |

These are unit conversion only — they do NOT distribute remainders (that's the read-side `calculateShares` job). The form's `use-expense-form-balancing.ts` auto-balances BY_AMOUNT so shares sum to `amount` before serialize.

The same `serializePaidFor` works for both expense-level and item-level paidFor since both have the same `{ splitMode, paidFor, amount }` shape.

**Cross-currency convention for serializers:**
- `serializePaidFor` with `conversionRate`: BY_AMOUNT shares are converted from original to ledger currency (`amountAsMinorUnits(shares * rate, ledgerCurrency)`). BY_PERCENTAGE/BY_SHARES/EVENLY shares are unitless — not converted.
- `serializePaidBy` with `conversionRate`: BY_AMOUNT shares stay in **original currency** (`amountAsMinorUnits(shares, originalCurrency)`) — `getBalances` applies `conversionRate` at read time. BY_PERCENTAGE/BY_SHARES/EVENLY shares are unitless — not converted.
- The converted `amount` is computed separately via `Decimal(originalAmount).mul(rate)` then `distributeRemainder`.

### `getTotalActiveUserShare` / `getTotalActiveUserPaidFor` delegate to `getBalances`

```
getTotalActiveUserShare(userId, expenses) =
  getBalances(expenses.filter(e => !e.isReimbursement))[userId]?.paidFor ?? 0
```

This guarantees the displayed total exactly matches the balance sheet. Drop `parseFloat(total.toFixed(2))`.

Alternative considered: keep per-expense summation via `calculateShare`. Rejected — it returns per-expense integer cents (per-expense distribution), which can drift from the global `getBalances` total. Delegating to `getBalances` ensures consistency.

## Risks / Trade-offs

- **[Behavioral change: cumulative balances shift ≤2¢]** → This is the intended accuracy fix. Groups with multiple fractional-split expenses will see slightly different (correct) totals. Existing tests with tolerance assertions (`< 3`) will be tightened to `=== 0`. Tests pinning the old "last participant absorbs" or "round each independently" behavior will be updated to the new rule.

- **[Per-expense preview vs balance sheet divergence]** → The per-expense preview shows per-expense distribution (e.g., 33/33/34), the balance sheet shows global distribution (e.g., 40/40/40 for $100+$20). This is the desired behavior — the per-expense view is honest about that expense's indivisible split, the cumulative view is fair. BY_AMOUNT has zero divergence (exact integers).

- **[Per-item modal vs aggregated total divergence]** → Same class: per-item preview shows per-item rounding, the aggregated card shows global-across-items distribution. ≤1¢ mismatch. Acceptable — each item must independently balance for display.

- **[Cross-currency conversion at Decimal precision]** → `Decimal(exactShare).mul(rate)` per-expense, accumulated globally, truncated at the end. The stored `amount` (= `Math.round(originalAmount * rate)` at write time) is trusted as the ledger truth. Conversion rounding drift is absorbed by the global `distributeRemainder`.

- **[ITEMIZED cross-currency treated as BY_SHARES]** → Preserves current behavior. The persisted shares (original cents) are treated as weights against the ledger `amount`. No behavior change; just routed through the unified core.

## Migration Plan

No database migration needed — the persisted share shape is unchanged. The refactor is purely computational:

1. Implement the new core (`calculateExactShares`, `distributeRemainder`, serializers) in `packages/domain/src/totals.ts`.
2. Rewrite `getBalances` to use global accumulation.
3. Rewrite `computePaidForFromItems` to use global-across-items accumulation.
4. Replace inline math in form (`submit-values.ts`) and importers with serializers.
5. Rewrite CSV export to use `calculateShares`.
6. Update tests to new assertions.
7. Run `bun check-types`, `bun run test`, `bun test:integration`.

Rollback: revert the code changes. No data migration to undo.

### Import cross-currency conversion via unified core

The import batch conversion (`batch.ts`) currently uses float `Math.round(amount * rate)` and largest-magnitude-absorbs-drift loops. The refactor routes this through the unified `serializePaidFor` / `serializePaidBy` helpers with `conversionRate` and `distributeRemainder` (Decimal precision, fractional-part distribution).

The stored currency convention is **preserved** (it's correct for `getBalances`):
- `paidByList.shares` → **original currency** cents (not rate-multiplied; `getBalances` applies `conversionRate` at read time via `payerBase = originalAmount`)
- `paidFor` BY_AMOUNT shares → **ledger currency** cents (rate-multiplied via `serializePaidFor` with `conversionRate`)
- `paidFor` EVENLY/BY_SHARES/BY_PERCENTAGE shares → **unitless** (weights/BPS; not converted)
- `amount` → ledger currency (converted via `Decimal(originalAmount).mul(rate)` then `distributeRemainder`)

The Spliit CSV importer quirk (paidBy sourced from the Original-cost column in original cents while paidFor is in row-currency cents) is preserved — `buildImportBatch` normalizes it when computing `effectiveOriginalAmount` and `effectiveOriginalCurrency`.

### Export currency semantics

CSV export per-participant net columns SHALL be in **ledger currency** (computed from `calculateShares(expense)` which uses `expense.amount`). The `Original cost`, `Original currency`, and `Conversion rate` columns are **informational** and in the original currency — they SHALL NOT be summed against the ledger-currency net columns.

JSON export emits raw stored values: `amount` and `paidFor.shares` (BY_AMOUNT) are in ledger currency; `originalAmount` is in original currency; `paidByList.shares` are in original currency for cross-currency expenses. The spec documents these denominations explicitly.

## Open Questions

- **`paidBySplitMode === 'ITEMIZED'`**: the `ITEMIZED` value SHALL remain in the `SplitMode` enum type — it's the core feature where items define the paidFor split, and the UI shows itemized expense creation. Only the dead *computation code* for `paidBySplitMode === 'ITEMIZED'` (the payer side, which the UI never sets) is cleaned up: `calculateExactPaidByShares` treats it as BY_AMOUNT (matching `getBalances`). This is a silent fix, not a breaking change, since no expense in production has `paidBySplitMode === 'ITEMIZED'`.

- **Coordination with `server-authoritative-currency-conversion`**: that change moves FX lookup to the server and makes the API authoritative for persisted ledger values. Our change provides the domain primitives (`serializePaidFor`/`serializePaidBy` with `conversionRate`, `distributeRemainder` with Decimal precision) that the server-authoritative change should reuse. The two changes are complementary: ours unifies the calculation core; the other moves the conversion authority. Implementation order: unified-expense-calculation first (provides the core), server-authoritative-currency-conversion second (uses it).
