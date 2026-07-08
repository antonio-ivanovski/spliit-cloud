## 1. Core: `calculateExactShares` and `distributeRemainder`

- [ ] 1.1 Define `SplitInput` type (`{ amount, splitMode, participants: Array<{ id, shares }> }`) in `packages/domain/src/totals.ts`
- [ ] 1.2 Implement `calculateExactShares(input: SplitInput): Record<string, Decimal>` — exact (non-truncated) per-participant Decimal shares for all 5 split modes (EVENLY, BY_SHARES, BY_PERCENTAGE, BY_AMOUNT, ITEMIZED)
- [ ] 1.3 Implement `distributeRemainder(exactShares, amount, opts?: { seed?, payerId? }): Record<string, number>` — truncate toward zero, distribute leftover by descending fractional part, expense-date-seeded tie-break, BY_AMOUNT payer fallback
- [ ] 1.4 Define `TieBreakStrategy` type and the `EXPENSE_DATE_SEEDED` strategy implementation (configurable interface for future strategies)
- [ ] 1.5 Add unit tests for `calculateExactShares` covering all 5 split modes, 0 amount, 0 total shares, empty participants
- [ ] 1.6 Add unit tests for `distributeRemainder` covering: exact division, positive remainder, negative amount (refund), tie-break with seed, BY_AMOUNT payer fallback, empty participants fallback

## 2. Core: Per-expense wrappers and serializers

- [ ] 2.1 Implement `calculateShares(expense): Record<string, number>` — delegates to `calculateExactShares` + `distributeRemainder` with expense-date seed and BY_AMOUNT/ITEMIZED payerId
- [ ] 2.2 Implement `calculatePaidByShares(expense): Record<string, number>` — symmetric for paidBy side with cross-currency conversion via `Decimal.mul(rate)`
- [ ] 2.3 Refactor `calculateShare(participantId, expense)` and `calculatePaidByShare(participantId, expense)` to thin delegates
- [ ] 2.4 Implement `serializePaidFor({ splitMode, paidFor, amount, currency, conversionRate? })` — BY_AMOUNT via `amountAsMinorUnits`, BY_PERCENTAGE via BPS, ELSE via `Math.round`
- [ ] 2.5 Implement `serializePaidBy({ paidBySplitMode, paidByList, amount, inputCurrency, conversionRate? })` — symmetric, original-currency aware for BY_AMOUNT
- [ ] 2.6 Drop `parseFloat(total.toFixed(2))` in `getTotalActiveUserShare` and delegate to `getBalances(expenses.filter(e => !e.isReimbursement))`
- [ ] 2.7 Same delegation for `getTotalActiveUserPaidFor`
- [ ] 2.8 Add unit tests for `calculateShares` / `calculatePaidByShares` covering per-expense scenarios (tie-break, negative amounts, payer-not-in-paidFor, BY_AMOUNT mismatch)
- [ ] 2.9 Add unit tests for `serializePaidFor` / `serializePaidBy` covering all split modes and cross-currency

## 3. Balance engine: `getBalances` global accumulation

- [ ] 3.1 Rewrite `getBalances(expenses)` in `packages/domain/src/balances.ts` to accumulate exact Decimal shares across all expenses per direction (paid/paidFor) using `calculateExactShares`
- [ ] 3.2 Apply cross-currency conversion via `Decimal.mul(conversionRate)` per-expense on the paidBy side; for ITEMIZED cross-currency, treat persisted shares as BY_SHARES weights against ledger `expense.amount`
- [ ] 3.3 Call `distributeRemainder(globalPaid, totalAmount, { seed: 0 })` and `distributeRemainder(globalPaidFor, totalAmount, { seed: 0 })` once each
- [ ] 3.4 Remove `Math.round` on accumulators and the `isLast = remaining` idiom
- [ ] 3.5 Remove the `match(expense.splitMode)` / `match(expense.paidBySplitMode)` blocks (replaced by `calculateExactShares`)
- [ ] 3.6 Keep `getSuggestedReimbursements` and `getPublicBalances` unchanged (they only consume final `total` per participant)
- [ ] 3.7 Update `balances.test.ts:89-91+94` — $100 EVENLY/3 → `33/33/34`, net=0 (was `33/33/33`, net=1)
- [ ] 3.8 Update `balances.test.ts:160-162` — BY_AMOUNT 101/10·3 → payer absorbs residual (was last absorbs)
- [ ] 3.9 Update `balances.test.ts:314` — BY_PERCENTAGE 20+30+30 of 50% → fractional-part distribution (was last absorbs)
- [ ] 3.10 Update `balances.test.ts:458-461` — $200 EVENLY/3 → `66/67/67`, net=0 (was `67/67/67`)
- [ ] 3.11 Update `balances.test.ts:547` — multi-payer BY_AMOUNT residual → payer absorbs (was last absorbs)
- [ ] 3.12 Update `balances.test.ts:1008-1010` — 1¢ EVENLY/3 → `0/0/1`, p0.total=0 (was `0/0/0`, p0.total=1; no residual to mask)
- [ ] 3.13 Tighten `balances.test.ts:165-226` tolerance from `< 3` to `=== 0`
- [ ] 3.14 Add test: 3 × $1 EVENLY/3 → cumulative `100/100/100` (zero cross-expense drift)
- [ ] 3.15 Add test: $100 + $20 EVENLY/3 → cumulative `4000/4000/4000` (the user's exact example)
- [ ] 3.16 Add test: 10 × $1 EVENLY/3 → single global distribution, not 10× per-expense
- [ ] 3.17 Add test: cross-currency multi-expense → `Σ paid === Σ amount` exactly at Decimal precision
- [ ] 3.18 Add test: balance sum invariant — `Σ paidFor === Σ amount` and `Σ paid === Σ amount` for any expense set

## 4. Itemized: global-across-items accumulation

- [ ] 4.1 Rewrite `computePaidForFromItems` in `packages/domain/src/itemized-expenses.ts` to call `calculateExactShares` per item (including filler), accumulate into a Decimal map, then `distributeRemainder` once
- [ ] 4.2 Drop `distributeEvenly` and `distributeWeighted` functions
- [ ] 4.3 Refactor `buildDefaultPaidForForSplitMode` to produce canonical weights/BPS directly (EVENLY/BY_SHARES → `shares: 1`, BY_PERCENTAGE → `Math.floor(10000 / n)`, BY_AMOUNT → `Math.floor(amount / n)`)
- [ ] 4.4 Update `itemized-expenses.test.ts:32` — single item unchanged (per-item == global for single item)
- [ ] 4.5 Update `itemized-expenses.test.ts:247` — multi-item with integer aggregates unchanged
- [ ] 4.6 Add test: two $50 EVENLY/3 items → aggregated `3333/3333/3334` (global-across-items, not `3332/3334/3334`)
- [ ] 4.7 Add test: filler participates in global accumulation (items sum < amount, filler distributed fairly)

## 5. Form: write-side serializers

- [ ] 5.1 Replace `submit-values.ts:51-62` (paidFor per-mode conversion) with `serializePaidFor` from `@spliit/domain/totals`
- [ ] 5.2 Replace `submit-values.ts:69-77` (paidByList per-mode conversion) with `serializePaidBy` from `@spliit/domain/totals`
- [ ] 5.3 Apply same serializer to `items` and `itemizedRemainder` in `submit-values.ts` (lines 96-139)
- [ ] 5.4 Verify form preview (`paid-for-row.tsx`, `paid-by-row.tsx`, `item-participants-modal.tsx`) auto-benefits from `calculateShare`/`calculatePaidByShare` delegation — no changes needed
- [ ] 5.5 Verify `active-user-balance.tsx:43` (`getBalances([toBalanceExpense(expense)])`) produces consistent single-expense results

## 6. Import: drop inline drift correctors

- [ ] 6.1 Replace inline drift corrector in `packages/domain/src/import/spliit-csv.ts:140-155` with `serializePaidFor`
- [ ] 6.2 Replace inline `Math.floor` + `+= 1` loop in `packages/domain/src/import/splitwise-csv.ts:122-147` with `serializePaidFor`
- [ ] 6.3 Replace inline `Math.round(... * shareRate)` drift corrector in `packages/domain/src/import/batch.ts:274-298` with `serializePaidFor` / `serializePaidBy`
- [ ] 6.4 Replace inline paidBy drift in `splitwise-csv.ts:155-163` with `serializePaidBy`
- [ ] 6.5 Update `spliit-csv.test.ts:144` — verify persisted BY_AMOUNT cents sum to `amount` exactly via `serializePaidFor`
- [ ] 6.6 Update `splitwise-csv.test.ts` — verify paidFor/paidBy reconstruction uses domain serializers
- [ ] 6.7 Verify `import/batch.ts` cross-currency import produces shares that `getBalances` consumes identically

## 7. CSV and JSON export

- [ ] 7.1 Rewrite `apps/api/src/routes/export-csv.ts:157-191` to call `calculateShares(expense)` per expense
- [ ] 7.2 Compute per-participant net as `(id === payerId) ? (expense.amount - shares[id]) : -shares[id]`
- [ ] 7.3 Emit `formatAmountAsDecimal(netAmount, currency)` as string (preserves trailing zeros)
- [ ] 7.4 Verify `Cost` column shows ledger-currency `expense.amount` and `Original cost`/`Original currency`/`Conversion rate` columns are retained as informational
- [ ] 7.5 Verify JSON export (`apps/api/src/routes/export-json.ts`) emits raw stored values with correct currency denomination — no changes needed if already correct, but verify
- [ ] 7.6 Update `multi-payer.test.ts:807` CSV export assertions if needed
- [ ] 7.7 Add cross-currency CSV export test: paid in USD, ledger EUR — verify net columns are EUR and sum to Cost, original columns are USD
- [ ] 7.8 Add cross-currency JSON export test: verify `amount` is ledger, `originalAmount` is original, `paidByList.shares` are original currency

## 8. Import cross-currency conversion

- [ ] 8.1 Rewrite `buildImportBatch` in `packages/domain/src/import/batch.ts` to use `Decimal(originalAmount).mul(rate)` and `distributeRemainder` for converted `amount` instead of `Math.round(amount * rate)`
- [ ] 8.2 Replace BY_AMOUNT `paidFor` conversion (`Math.round(p.shares * shareRate)`) with `serializePaidFor` with `conversionRate`
- [ ] 8.3 Replace `paidBy` drift corrector (largest-magnitude loop) with `serializePaidBy` — keep `paidByList.shares` in original currency (not rate-multiplied)
- [ ] 8.4 Remove all largest-magnitude-absorbs-drift loops from `batch.ts`
- [ ] 8.5 Verify unitless shares (EVENLY/BY_SHARES/BY_PERCENTAGE) are NOT converted — leave as weights/BPS
- [ ] 8.6 Update `mapping.test.ts:689-836` cross-currency tests to assert Decimal-precision conversion and `distributeRemainder` drift handling
- [ ] 8.7 Add cross-currency import integration test: verify persisted `paidByList.shares` are in original currency, `paidFor` BY_AMOUNT in ledger currency, `amount` in ledger currency, and `getBalances` produces zero net

## 9. Integration and verification

- [ ] 9.1 Run `bun check-types` — fix any type errors from the refactor
- [ ] 9.2 Run `bun check-formatting` — fix formatting
- [ ] 9.3 Run `bun run test` — all unit tests pass (domain + web + api mocks)
- [ ] 9.4 Run `bun test:integration` — API + web integration tests pass (requires DB + API on :3001)
- [ ] 9.5 Verify settlement integration tests (`multi-payer.test.ts:661-793`) — single-expense exact splits, zero drift
- [ ] 9.6 Verify recurring expense tests (`multi-payer.test.ts:595-654`) — clone shares verbatim, `calculateExactShares` reproduces
- [ ] 9.7 Verify `totals.test.ts` float-tolerance assertions (`toBeCloseTo(100/3)`) tightened to exact integer cents
- [ ] 9.8 Verify all three entry paths (create, import, force-settle) produce stored shapes that `getBalances` consumes identically
- [ ] 9.9 Verify cross-currency expenses from all entry paths (create, import) produce `getBalances` results with `Σ paid === Σ amount` exactly
