## 1. Model And Contract Decisions

- [ ] 1.1 Confirm nullable original-share fields are added for converted `BY_AMOUNT` paid-for rows.
- [ ] 1.2 Implement largest-remainder deterministic rounding for converted totals and converted `BY_AMOUNT` shares.
- [ ] 1.3 Expose the preview rate API as a tRPC procedure.

## 2. Database And Domain Schemas

- [ ] 2.1 Add any required conversion metadata columns, such as requested rate date and provider rate as-of date, to expenses.
- [ ] 2.2 Add nullable original-share storage to paid-for rows for converted `BY_AMOUNT` edit-form replay.
- [ ] 2.3 Update Prisma migration and generated client.
- [ ] 2.4 Update domain schemas so expense create/update payloads treat submitted `amount` as the user-entered amount in the selected expense currency.
- [ ] 2.5 Validate supported original and ledger currency codes before attempting conversion.
- [ ] 2.6 Remove custom currency choices from group and expense schemas for new/update inputs while preserving read compatibility for existing custom-currency rows.
- [ ] 2.7 Ensure amount parsing uses selected/input currency decimal digits and persisted ledger amounts use Ledger currency decimal digits.

## 3. Server Currency Conversion

- [ ] 3.1 Implement a server-side currency-rate provider client for the existing external provider.
- [ ] 3.2 Add an in-memory rate cache keyed by currency pair and requested date.
- [ ] 3.3 Return rate, requested date, provider as-of date, and cache/provider error details from the rate service.
- [ ] 3.4 Implement server-side conversion helpers for expense totals and amount-based paid-for shares.
- [ ] 3.5 Ensure converted `BY_AMOUNT` shares sum to the persisted converted expense amount after rounding.
- [ ] 3.6 Add pair-level latest cached-rate lookup with a 7-day sanity limit for provider-unavailable fallback.

## 4. Expense Persistence

- [ ] 4.1 Update expense create logic to compute converted amounts, shares, and conversion metadata server-side.
- [ ] 4.2 Update expense update logic to recompute converted amounts, shares, and conversion metadata when original/input conversion fields change.
- [ ] 4.3 Reject client-submitted authoritative converted amount/rate fields outside the input amount/currency contract.
- [ ] 4.4 Preserve existing same-currency expense behavior without original-currency conversion metadata.
- [ ] 4.5 Preserve existing converted expenses without retroactive recomputation during deployment.
- [ ] 4.6 Apply the same server-authoritative conversion behavior to converted reimbursement expenses.
- [ ] 4.7 Ignore silently any out-of-contract client conversion fields while ensuring persistence reads only the input amount/currency contract and server-resolved rate.

## 5. Group Currency Blocking

- [ ] 5.1 Update group update validation so base currency can change only while the Ledger has no expenses.
- [ ] 5.2 Return a user-facing error when a currency change is rejected because expenses exist.
- [ ] 5.3 Allow non-currency group updates after expenses exist without changing base currency.

## 6. Web UI

- [ ] 6.1 Replace direct browser calls to the external currency API with the server preview rate API.
- [ ] 6.2 Treat preview conversion as illustrative and submit the entered amount plus selected expense currency for all expenses.
- [ ] 6.3 Enter `BY_AMOUNT` split shares in the expense original/input currency when conversion is required.
- [ ] 6.4 Display both original/input and converted Ledger-currency amounts on expense creation/edit/detail surfaces where useful.
- [ ] 6.5 Display only Ledger base-currency amounts in balances, reimbursements, settlements, summaries, and statistics.
- [ ] 6.6 Disable or block group currency editing in the UI once expenses exist.
- [ ] 6.7 Allow expense currency changes during edit while keeping the entered numeric amount unchanged by default and recomputing preview conversion.
- [ ] 6.8 For edited converted `BY_AMOUNT` expenses, keep numeric paid-for share amounts unchanged by default when currency changes and allow the user to rebalance before saving.
- [ ] 6.9 Remove custom currency options from group and expense currency selectors.

## 7. Exports

- [ ] 7.1 Include server-used conversion metadata and provider as-of date in JSON exports where available.
- [ ] 7.2 Include server-used conversion metadata and provider as-of date in CSV exports where available.
- [ ] 7.3 Keep exported accounting totals in Ledger base currency.
- [ ] 7.4 Keep converted `BY_AMOUNT` original split-share metadata internal and out of initial CSV/JSON exports.

## 8. Tests And Verification

- [ ] 8.1 Add unit tests for rate cache miss fetching from the provider and storing rate/as-of metadata.
- [ ] 8.2 Add unit tests for rate cache hit returning cached data without calling the provider.
- [ ] 8.3 Add unit tests for unsupported pair, provider non-OK response, missing target rate, and provider date fallback behavior including future-date fallback.
- [ ] 8.4 Add unit tests for provider-unavailable cached fallback using latest pair rate within 7 days and rejecting fallback older than 7 days.
- [ ] 8.5 Add unit tests for same-currency expenses proving no conversion fields are required and amounts remain unchanged.
- [ ] 8.6 Add unit tests for converted total calculation in minor units using server-resolved rates.
- [ ] 8.7 Add unit tests for converted `BY_AMOUNT` shares entered in original currency and persisted in Ledger currency.
- [ ] 8.8 Add unit tests for largest-remainder rounding when converted shares would otherwise under-sum or over-sum the converted total.
- [ ] 8.9 Add unit tests proving converted `BY_AMOUNT` original-share metadata reloads exact original split inputs.
- [ ] 8.10 Add tests proving `BY_PERCENTAGE`, `EVENLY`, and `BY_SHARES` converted expenses compute Ledger-currency totals while preserving their existing split semantics.
- [ ] 8.11 Add conversion tests for zero-decimal currencies such as JPY/KRW/IDR as original currency, Ledger currency, and split input currency.
- [ ] 8.12 Add conversion tests for negative/income converted expenses so sign and rounding remain correct.
- [ ] 8.13 Add API tests proving submitted `amount` is interpreted as input-currency amount for both same-currency and converted expenses.
- [ ] 8.14 Add API tests proving expense create silently ignores client-authoritative converted amount/rate fields outside the input amount/currency contract.
- [ ] 8.15 Add API tests proving expense update recomputes conversion when entered amount, selected currency, split inputs, or existing expense date changes.
- [ ] 8.16 Add API tests proving converted reimbursement expenses follow the same conversion and accounting rules.
- [ ] 8.17 Add API tests proving balance calculations use only persisted Ledger-currency amounts and shares for mixed same-currency and converted expenses.
- [ ] 8.18 Add API tests proving base currency changes are allowed before expenses exist and rejected after expenses exist.
- [ ] 8.19 Add API and UI tests proving custom/empty/unsupported currencies cannot be selected or submitted for new/update group and expense flows.
- [ ] 8.20 Add web/component tests for tRPC preview conversion, original-currency `BY_AMOUNT` split input, and original-plus-converted expense display.
- [ ] 8.21 Add web/component tests proving editing an expense from one currency to another keeps numeric amount and amount-based split shares unchanged by default while recomputing preview conversion.
- [ ] 8.22 Add web/component tests proving balances, reimbursements, summaries, and statistics show only Ledger base-currency values.
- [ ] 8.23 Add export tests for converted and same-currency expenses, including expense-level conversion metadata where available and excluding original split-share metadata.
- [ ] 8.24 Run `bun check-types`, `bun check-formatting`, and `bun run test`.
