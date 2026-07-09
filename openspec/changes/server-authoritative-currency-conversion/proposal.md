## Why

Currency conversion math was still performed in the browser and trusted by the API, which made ledger amounts vulnerable to client drift. Rate *lookup* already went through the API, but rate *application* for persistence did not.

Multi-currency expenses should preserve what the user entered, record *how* the conversion rate was chosen via a structured conversion discriminant, and make the server the authority for all ledger-currency values.

## What Changes

- Make the API authoritative for conversion math on expense create/update and import.
- Introduce a **discriminated union** conversion contract on the API (optional field):
  - absent / undefined — same currency as ledger (group currency)
  - `{ type: 'custom', currency, rate }` — user-supplied rate
  - `{ type: 'exchange', currency }` — server resolves provider rate
- Persist flat columns: nullable `conversionSource` (`EXCHANGE` | `CUSTOM` only; null = same currency), `originalAmount`, `originalCurrency`, `conversionRate`. **No `NONE` enum value. No `conversionAsOf`.**
- Submit and store amount / `BY_AMOUNT` shares / items in expense currency; server computes ledger total.
- Exchange rates for past/present dates use expense date; future-dated `EXCHANGE` uses today's rate.
- Custom currencies require `custom` conversion (or `none` when matching ledger).
- Import: preview via bulk rates; persistence uses the same server resolver as create.
- Block changing group base currency after expenses exist.
- Activity feed tracks conversion source and rate changes.
- **BREAKING**: create/update no longer accept client-authoritative ledger amounts; monetary inputs are expense currency + `conversion` discriminant.

## Capabilities

### Modified Capabilities

- `ledger-accounting`: Server-authoritative conversion, conversion discriminant, original-currency share storage, rate date rules, immutable base currency after expenses.
- `expenses`: Create/update/import contracts and UI for the conversion union.
- `groups`: Currency updates rejected once expenses exist.
- `exports`: Include `conversionSource` (not as-of); ledger-currency accounting columns unchanged.

## Impact

- Domain: `expenseConversionInputSchema` discriminated union; `ConversionSource` is `EXCHANGE` | `CUSTOM` only.
- API: `resolveConversion` from the union; flat persistence; activity differs for source/rate.
- Web: form maps `conversionType` + rate → union on submit; restore EXCHANGE vs CUSTOM correctly.
- Database: nullable `conversionSource` enum without `NONE`; no `conversionAsOf`.
- Testing: union paths, future-date exchange, import, custom currency, base-currency lock, balance invariants.
