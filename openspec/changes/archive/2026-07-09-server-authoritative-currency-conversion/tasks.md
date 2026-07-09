## 1. Model And Contract

- [x] 1.1 API `conversion` optional discriminated union: absent = same currency; `custom` | `exchange` (Zod `discriminatedUnion`)
- [x] 1.2 DB: nullable `conversionSource` enum `EXCHANGE` | `CUSTOM` only (null = same currency); no `NONE`
- [x] 1.3 Remove `conversionAsOf` (not needed)
- [x] 1.4 Create/update input: amount + shares/items in expense currency; server computes ledger amount
- [x] 1.5 Validate conversion vs currencies (custom currency cannot use exchange)
- [x] 1.6 Clean migration (drop/recreate local DB as needed)
- [x] 1.7 Prisma generate + domain types

## 2. Domain And Balance Math

- [x] 2.1 BY_AMOUNT paid-for shares are expense-currency when converted
- [x] 2.2 Itemized items remain expense currency
- [x] 2.3 Balances convert via rate + distributeRemainder
- [x] 2.4 Same-currency path unchanged (null conversionSource)
- [x] 2.5 Domain Zod schemas use conversion discriminant

## 3. Rate Resolution

- [x] 3.1 Reuse currency-rates.ts for EXCHANGE
- [x] 3.2 Past/today: rate for expense date
- [x] 3.3 Future: rate for today
- [x] 3.4 Simple in-memory cache
- [x] 3.5 Preview APIs remain preview-only
- [x] 3.6 Provider failure blocks EXCHANGE saves; none/custom still work

## 4. Expense Persistence

- [x] 4.1 Create: resolveConversion from union; persist flat columns
- [x] 4.2 Update: recompute on change
- [x] 4.3 Client ledger totals not authoritative
- [x] 4.4 Same rules for reimbursements
- [x] 4.5 Persist conversionSource + rate (no asOf)

## 5. Import

- [x] 5.1 Bulk rates for preview only
- [x] 5.2 Server resolveConversion on import
- [x] 5.3 perDate → exchange; fixed → custom
- [x] 5.4 Custom currencies require custom rates
- [x] 5.5 Import batch sends expense-currency amounts + conversion discriminant
- [x] 5.6 Spliit parsers always recover original amount from ledger ÷ rate (upstream #513 — broken originalAmount drops cents)
- [x] 5.7 resolveImportExpenseMoney selects original fields over ledger; normalizePaidForByAmount scales BY_AMOUNT shares
- [x] 5.8 Activity currencyCode falls back to ledger currency for same-currency imports

## 6. Group Currency Blocking

- [x] 6.1–6.4 Block ledger currency change when expenses exist

## 7. Web UI

- [x] 7.1 submit-values builds conversion discriminant
- [x] 7.2 Restore EXCHANGE vs CUSTOM correctly (not from bare rate)
- [x] 7.2a/b Exchange wording + Frankfurter note
- [x] 7.3–7.9 Shares in expense currency; ledger-only balances; currency lock

## 8. Exports

- [x] 8.1–8.4 conversionSource + rate in CSV/JSON; no as-of column

## 9. Tests And Verification

- [x] 9.1–9.10 Unit/integration coverage for conversion paths
- [x] 9.11 check-types, check-formatting, test
