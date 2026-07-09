## 1. Model And Contract

- [ ] 1.1 Add persisted `conversionSource` enum: `NONE` | `EXCHANGE` | `CUSTOM` on expenses (Prisma + domain).
- [ ] 1.2 Add `conversionAsOf` (provider as-of date) when source is `EXCHANGE` and as-of is known.
- [ ] 1.3 Define create/update input contract: submitted amount, `BY_AMOUNT` shares, paid-by amount shares, and items are always original/input currency; server computes ledger `amount`.
- [ ] 1.4 Validate source vs currencies: same currency → `NONE`; custom/unsupported pair → not `EXCHANGE`; `CUSTOM` requires positive rate; `EXCHANGE` rejects client rate as authority (server resolves).
- [ ] 1.5 Single-currency-per-expense invariant: amount, paidBy, paidFor, items share one currency.
- [ ] 1.6 Migration/backfill: existing rows without original currency/rate → `NONE`; rows with original + rate → `CUSTOM` (unknown provenance).
- [ ] 1.7 Update Prisma migration and generated client.

## 2. Domain And Balance Math

- [ ] 2.1 Treat stored `BY_AMOUNT` paid-for shares as original-currency minor units when source is not `NONE`.
- [ ] 2.2 Ensure itemized item amounts remain original-currency (already true) and balance paths convert consistently.
- [ ] 2.3 Update balance / share helpers so original-currency paidFor (and paidBy) convert via persisted rate with `convertByRate` + `distributeRemainder`, preserving Σ paid / Σ paidFor = Σ ledger amount.
- [ ] 2.4 Keep `NONE` path identical to current same-currency behavior.
- [ ] 2.5 Update domain Zod schemas and types for `conversionSource` + input-currency contract.

## 3. Rate Resolution (reuse existing service)

- [ ] 3.1 Reuse `apps/api/src/lib/currency-rates.ts` for `EXCHANGE` resolution (no new provider client).
- [ ] 3.2 Past/today expense dates: resolve rate for expense date.
- [ ] 3.3 Future expense dates: resolve rate for **today**; surface as-of/today messaging to callers.
- [ ] 3.4 Keep in-memory cache behavior simple (hit serves, miss fetches; no multi-day stale-fallback policy).
- [ ] 3.5 Keep tRPC `currency.getRate` and Hono bulk `POST /currency/rates` for **preview** only.
- [ ] 3.6 On provider failure / uncached miss for `EXCHANGE`, fail the save with a clear error; allow `NONE` and `CUSTOM`.

## 4. Expense Persistence

- [ ] 4.1 Create expense: resolve source/rate server-side; persist original inputs; compute ledger `amount`.
- [ ] 4.2 Update expense: recompute when amount, currency, source, custom rate, date, or amount splits/items change.
- [ ] 4.3 Ignore or reject client-submitted authoritative ledger totals outside the input contract.
- [ ] 4.4 Apply the same rules to reimbursement expenses.
- [ ] 4.5 Persist `conversionSource`, rate, and as-of (when exchange) for audit/edit/export.

## 5. Import

- [ ] 5.1 Keep bulk rate API for import **preview** UI only.
- [ ] 5.2 Perform conversion inside the import persistence path server-side (same source/date rules as create).
- [ ] 5.3 ISO destination + ISO source without custom override → `EXCHANGE`.
- [ ] 5.4 Custom/unsupported currencies → require custom rates, source `CUSTOM`; never call exchange for those pairs.
- [ ] 5.5 Do not trust client-preconverted ledger amounts as authoritative on import.

## 6. Group Currency Blocking

- [ ] 6.1 Reject ledger base currency changes when any expenses exist.
- [ ] 6.2 Return a user-facing error on rejected currency change.
- [ ] 6.3 Allow non-currency group updates after expenses exist.
- [ ] 6.4 Continue allowing custom and ISO currencies on create/update when the ledger has no expenses.

## 7. Web UI

- [ ] 7.1 Submit original/input amount, currency, `conversionSource`, and (when custom) rate; stop client-side ledger conversion in `submit-values.ts`.
- [ ] 7.2 Wire existing exchange/custom rate form actions to persist and restore `conversionSource` (no new conversion UX redesign).
- [ ] 7.2a Update exchange option copy to localized “exchange rate” wording (not “API rate” / Frankfurter-first label).
- [ ] 7.2b When the exchange option is shown, display a small note that rates come from https://frankfurter.dev/ and their API (via `bun i18n` for locale strings).
- [ ] 7.3 Enter `BY_AMOUNT` shares and items in expense currency only.
- [ ] 7.4 Show original amount, source, rate/as-of, and converted ledger amount on expense create/edit/detail where useful.
- [ ] 7.5 Show only ledger amounts in balances, reimbursements, settlements, summaries, and statistics.
- [ ] 7.6 When expense date is in the future and source is `EXCHANGE`, show that today's rate will be used.
- [ ] 7.7 Disable group currency editing once expenses exist.
- [ ] 7.8 Keep custom currency options; when conversion is required for unsupported pairs, force custom rate action (no exchange option).
- [ ] 7.9 Import wizard: preview rates via bulk API; rely on server for final conversion.

## 8. Exports

- [ ] 8.1 Include `conversionSource`, rate, and as-of (when available) in JSON exports.
- [ ] 8.2 Include the same metadata in CSV exports where columns exist or are added.
- [ ] 8.3 Keep exported accounting totals in ledger base currency.
- [ ] 8.4 Label custom vs exchange provenance so exports do not imply provider rates for `CUSTOM`.

## 9. Tests And Verification

- [ ] 9.1 Unit: `NONE` / `EXCHANGE` / `CUSTOM` create and update paths.
- [ ] 9.2 Unit: future expense date uses today for `EXCHANGE`; past uses expense date.
- [ ] 9.3 Unit: balances convert original-currency paidFor/paidBy and preserve sum invariants.
- [ ] 9.4 Unit: custom currency cannot use `EXCHANGE`; requires `CUSTOM`.
- [ ] 9.5 Unit: rate cache hit/miss and provider failure behavior for `EXCHANGE`.
- [ ] 9.6 API: client ledger totals are not authoritative; server computes amount.
- [ ] 9.7 API: group currency change blocked after expenses exist.
- [ ] 9.8 API/import: server-side conversion; custom currency import rates; preview vs persist separation.
- [ ] 9.9 Web: existing rate actions set `conversionSource`, “exchange rate” wording + Frankfurter attribution note, future-date messaging, original-currency share input, ledger-only balances.
- [ ] 9.10 Export: source + metadata for converted and same-currency expenses.
- [ ] 9.11 Run `bun check-types`, `bun check-formatting`, and `bun run test`.
