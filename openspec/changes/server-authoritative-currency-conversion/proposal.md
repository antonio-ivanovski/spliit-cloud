## Why

Currency conversion math is still performed in the browser and trusted by the API, which makes ledger amounts vulnerable to client drift and unverifiable `amount` versus `originalAmount * conversionRate` relationships. Rate *lookup* already goes through the API (tRPC preview + bulk Hono route with in-memory cache), but rate *application* for persistence does not.

Multi-currency expenses should preserve what the user entered (amount, currency, split shares, and items in that currency), record *how* the conversion rate was chosen (`conversionSource`: none / exchange provider / custom), and make the server the authority for all ledger-currency values used by balances, reimbursements, statistics, and exports.

## What Changes

- Make the API authoritative for conversion math on expense create/update and import. Client previews remain illustrative only.
- Introduce a persisted `conversionSource` on each expense: `NONE` (same currency as ledger), `EXCHANGE` (provider rate), or `CUSTOM` (user-supplied rate). Users can view and change this when creating or editing.
- Submit and store expense amount, `BY_AMOUNT` shares, paid-by amount shares, and itemized item amounts in the expense's original/input currency. The server computes the ledger-currency total used for accounting and converts shares at balance/settlement time using the persisted rate.
- Persist server-used conversion metadata (`conversionRate`, provider as-of when exchange-sourced) for audit and display.
- **Exchange rates for past/present expense dates**: resolve the rate for the expense date (historical when available).
- **Future-dated expenses with `EXCHANGE`**: use today's rate (not a speculative future rate) to avoid provider missing-date edge cases; the UI states that today's rate will be used when the expense date is in the future.
- Custom (non-ISO / free-text) currencies remain allowed on write. Expenses in a custom currency **must** use `CUSTOM` conversion (or `NONE` when the ledger base is the same custom currency); exchange-provider conversion is rejected for unsupported pairs.
- Import: bulk rate API remains for **preview only**; the import mutation applies conversion server-side. Custom-currency import expenses use custom rates, not the exchange provider.
- Block changing a Ledger/group base currency after expenses exist.
- Keep balance, reimbursement, summary, and statistics calculations exclusively based on ledger/base-currency minor units (derived via the persisted rate).
- Show original and converted amounts on expense-oriented UI; show only ledger amounts on balances and settlements.
- Reuse the existing expense-form exchange/custom rate actions; wire them so the chosen source is persisted as `conversionSource`. Label the exchange option with localized “exchange rate” wording and show a small note that rates come from https://frankfurter.dev/ and their API.
- **BREAKING**: Expense create/update no longer accepts client-authoritative converted ledger amounts or client-normalized ledger `BY_AMOUNT` shares. Submitted monetary inputs are original/input currency; the server owns ledger conversion.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `ledger-accounting`: Server-authoritative conversion, `conversionSource`, original-currency share/item storage, rate resolution rules (including future-dated expenses), and immutable base currency after expenses exist.
- `expenses`: Create/update/import contracts and UI semantics for `conversionSource`, original-currency inputs, and preview vs authority.
- `groups`: Group currency updates rejected once a group ledger contains expenses (custom and ISO currencies both allowed on create/update when empty of expenses).
- `exports`: Exports include `conversionSource` and server-used conversion metadata without changing ledger-currency accounting columns.

## Impact

- API: reuse existing rate service for exchange resolution; compute ledger totals and apply `conversionSource` rules on create/update/import; reject invalid source/currency combinations.
- Web: submit original/input amounts and `conversionSource`; keep existing exchange/custom rate UI actions and persist the choice; use localized “exchange rate” wording plus a small Frankfurter (https://frankfurter.dev/) API attribution note; show future-date "today's rate" messaging; disable group currency edit when expenses exist.
- Database: add `conversionSource` (and as-of metadata if not already present); reinterpret share/item storage as original currency for converted expenses; no separate `originalShare` column needed.
- Domain: expense schemas include `conversionSource`; balances convert original-currency shares via persisted rate; reuse `convertByRate` / `distributeRemainder` from unified expense calculation.
- Testing: conversion sources, future-date rate rules, import server conversion, custom currency + custom rate, base-currency change blocking, balance invariants.
- Out of scope for now: special recurring-instance rate re-resolution (instances continue to copy conversion fields from the current frame unless a later change revisits this).
