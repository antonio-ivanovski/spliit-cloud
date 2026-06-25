## Why

Currency conversion is currently performed in the browser and trusted by the API, which makes ledger amounts vulnerable to client drift, inconsistent exchange-rate lookup, and unverifiable `amount` versus `originalAmount * conversionRate` relationships. Multi-currency expenses should preserve what the user entered while making the server the authority for all persisted ledger-currency values used by balances, splits, reimbursements, statistics, and exports.

## What Changes

- Move exchange-rate lookup behind the API and cache provider responses in memory to avoid repeated external calls during normal usage.
- Treat client-side conversion as preview-only; the client submits the entered amount, selected currency, and split inputs alongside the existing expense date, and the server computes persisted ledger-currency values when the selected currency differs from the Ledger base currency.
- Persist the server-used conversion rate and rate date/as-of metadata together with the expense so historical expenses remain auditable.
- For `BY_AMOUNT` splits on a converted expense, accept split amounts in the same original/input currency as the expense and persist normalized ledger-currency shares for balance math.
- Keep balance, reimbursement, summary, and statistics calculations exclusively based on ledger/base-currency minor units.
- Show both original and converted amounts in expense-oriented UI where useful, but show only ledger/base-currency amounts in balances and settlements.
- Block changing a Ledger/group base currency after expenses exist; base currency changes remain allowed only before the ledger has expenses.
- Remove custom currency support for new/updated groups and expenses; only supported ISO currency codes can be selected.
- **BREAKING**: For expense create/update APIs, submitted `amount` means the user-entered amount in the selected expense currency; the API no longer accepts client-submitted converted amount, conversion rate, or ledger-currency `BY_AMOUNT` shares for converted expenses.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `ledger-accounting`: Server-authoritative conversion, persisted FX metadata, original-currency amount-split handling, and immutable base currency after expenses exist.
- `expenses`: Expense create/update contracts and UI semantics change so submitted amount/currency represent the user-entered input while the server stores normalized ledger values.
- `groups`: Group currency updates are limited to supported currencies and rejected once a group ledger contains expenses.
- `exports`: Exports include the original currency fields and server-used conversion metadata without changing the ledger-currency values used for accounting.

## Impact

- API: add a currency-rate lookup/cache service, validate supported currencies, compute converted expense totals and amount-based shares server-side, and reject post-expense base-currency changes.
- Web: route conversion previews through the API, submit input amount/currency values for expenses, remove custom currency choices, display original and converted amounts on expense views, and prevent group currency edits when expenses exist.
- Database: likely add conversion metadata such as requested rate date and provider-returned `conversionAsOf`; consider original share storage for amount-based splits to support faithful edit forms.
- Domain: update expense schemas so converted expense payloads distinguish original/input amounts from persisted ledger-currency values.
- Testing: cover FX cache behavior, conversion rounding, amount-split normalization, base-currency change blocking, and balance invariants.
