## Context

Spliit already proxies exchange-rate lookup through the API:

- tRPC `currency.getRate` for expense-form preview
- Hono `POST /currency/rates` for bulk/import preview
- `apps/api/src/lib/currency-rates.ts` — Frankfurter client, in-memory cache (`requestedDate` + `asOfDate`), tests

The browser does **not** call the FX provider directly. What remains client-authoritative is **conversion application**: `submit-values.ts` multiplies by the rate and submits ledger-currency `amount` and (for `BY_AMOUNT`) ledger-currency paid-for shares. The API stores those fields without verifying or recomputing them.

Domain primitives from `unified-expense-calculation` already exist and should be reused: `ExactAmount` / `convertByRate`, `distributeRemainder`, `serializePaidFor` / `serializePaidBy`, balance engine cross-currency paths.

The expense form already has exchange vs custom rate actions. Only `conversionRate` is stored today — there is no persisted flag for exchange vs custom. Copy should present the exchange option as a localized **exchange rate** action (not “API rate”), with a small attribution note that rates come from [Frankfurter](https://frankfurter.dev/) and their API.

## Goals / Non-Goals

**Goals:**

- Make the API authoritative for conversion math on expense create/update and import.
- Persist `conversionSource`: `NONE` | `EXCHANGE` | `CUSTOM`.
- Keep user-entered amount, shares, and items in a single original/input currency per expense.
- Derive ledger-currency values for accounting from original inputs + the source-resolved rate.
- Resolve `EXCHANGE` rates by expense date for past/present dates; use **today's** rate for future-dated expenses.
- Keep balances, reimbursements, settlements, summaries, and statistics in ledger base-currency minor units.
- Allow custom (non-ISO) currencies on write; force `CUSTOM` when exchange cannot price the pair.
- Reuse the existing rate service and cache; keep bulk rate endpoint for previews; run import conversion on the server.
- Reuse existing create/edit rate UI actions; persist the user's choice as `conversionSource`.
- Block ledger base-currency changes after expenses exist.

**Non-Goals:**

- Full ledger rebasing from one base currency to another.
- Redis or other distributed cache.
- Becoming a complete FX provider or supporting pairs the provider cannot price under `EXCHANGE`.
- Changing percentage / shares / evenly semantics beyond conversion of the original-currency total into ledger units for accounting.
- Recalculating historical expenses after save.
- Special recurring-instance exchange re-resolution (out of scope for now; instances keep copying conversion fields from the current frame as today).
- Removing custom currencies (deferred expansion; this change only constrains how they convert).
- Mixing currencies inside one expense (paidBy / paidFor / items always share the expense currency).
- Redesigning the rate UI from scratch when existing exchange/custom actions already cover the interaction.

## Decisions

### `conversionSource` is first-class

Each expense persists `conversionSource`:

| Source | When | Rate |
|--------|------|------|
| `NONE` | Expense currency equals ledger base currency (ISO or same custom) | No rate; ledger amount equals original amount |
| `EXCHANGE` | Different **supported ISO** currency than ledger | Server resolves rate via existing provider/cache |
| `CUSTOM` | User override, or any case exchange cannot price (including custom currencies) | Client-submitted positive rate; server validates and applies it |

The existing form actions map directly to `EXCHANGE` / `CUSTOM` and become durable state, editable later, and visible on detail/export.

Wording for the exchange option:

- Action label: localized “exchange rate” phrasing (e.g. en-US: “Use exchange rate”), not “API rate” or a Frankfurter-first label.
- Companion note (small, secondary text) when that option is shown/selected: rates are provided by [Frankfurter](https://frankfurter.dev/) via their API.
- Custom option keeps localized “custom rate” phrasing.

Alternative considered: infer source from whether the rate matches the provider. Ambiguous after rate changes and impossible for audit. Explicit `conversionSource` is clearer.

### Submitted monetary fields are always original/input currency

For every expense:

- Submitted `amount` is what the user typed in the selected expense currency.
- `BY_AMOUNT` paid-for shares, paid-by amount shares, and itemized item amounts are entered and **stored** in that same original currency.
- One expense has exactly one currency for amount, paidBy, paidFor, and items — never mixed.

The server:

1. Validates `conversionSource` vs currencies (e.g. custom currency → not `EXCHANGE`).
2. Resolves rate for `EXCHANGE`, or accepts rate for `CUSTOM`, or clears rate for `NONE`.
3. Computes and persists ledger-currency `Expense.amount` for accounting.
4. Persists original amount, original currency, `conversionSource`, rate, and exchange as-of when applicable.
5. Persists shares/items in original currency without client-side conversion.

Balances and settlements convert original-currency shares into ledger units using the persisted rate (reuse `convertByRate` + `distributeRemainder` so shares sum to the ledger total).

No separate `originalShare` column: the stored share **is** the original input.

### Server owns ledger conversion; client preview is illustrative

Preview continues to use tRPC `currency.getRate` and bulk `POST /currency/rates`. Persisted values always come from server resolution + server math. Client-submitted ledger amounts or "authoritative" rates outside the source contract are ignored or rejected.

For `CUSTOM`, the submitted rate **is** the authority (user intent), but the server still multiplies and rounds — the client does not submit pre-converted ledger amounts.

### Rate date rules

```
                 expenseDate ≤ today              expenseDate > today
EXCHANGE         rate for expense date            rate for **today**
                 (historical when available)      (UI discloses this)
CUSTOM           use submitted rate
NONE             no rate
```

Rationale for future-dated `EXCHANGE`: providers often cannot return a true future rate; using today's rate avoids save failures and is honest if the UI states it.

### Existing rate service and simple cache

Keep `currency-rates.ts` as-is in spirit:

- In-memory cache keyed by date + pair.
- Historical rates are stable once fetched; keep it simple: cache hit serves; miss fetches; provider failure blocks `EXCHANGE` saves (`NONE` and `CUSTOM` still work).

Bulk `POST /currency/rates` stays for **preview** (import wizard, multi-date UI). Import **persistence** converts on the server inside the import path using the same resolution rules as expense create.

### Custom currencies

Custom / empty / non-provider currencies remain writable for groups and expenses.

Rules:

- Ledger base may be custom.
- Expense may use custom currency.
- If expense currency equals ledger base (including both custom with the same representation), source is `NONE`.
- If they differ and either side is not a supported ISO pair for the provider, source must be `CUSTOM` with a user rate.
- Import must not call the exchange provider for custom-currency pairs; it requires custom rates in the import config or rejects conversion for those rows with a clear error.

### Split modes under conversion

- `EVENLY` / `BY_PERCENTAGE` / `BY_SHARES`: original total stored; ledger total computed server-side; split semantics apply against the accounting total via existing domain helpers.
- `BY_AMOUNT`: shares stored in original currency and must sum to the original amount; conversion to ledger happens in the balance/settlement path.
- `ITEMIZED`: item amounts already original currency; keep that; do not convert item rows at write.

Precision: parse inputs with the expense currency's decimal digits; ledger `amount` uses ledger currency decimal digits via integer minor units.

### Block base-currency changes after expenses exist

Changing the ledger base after expenses exist would invalidate all persisted ledger amounts unless a full rebase exists. Block currency changes when any expense exists. Non-currency group updates remain allowed.

### UI: reuse existing rate actions

Create/edit already exposes easy actions for exchange vs custom rate. This change:

- Persists that choice as `conversionSource`
- Keeps the interaction familiar (no new conversion UX redesign)
- Labels the exchange action as localized **exchange rate** copy
- Shows a small note that the exchange source is https://frankfurter.dev/ and their API
- Adds future-date copy when `EXCHANGE` uses today's rate
- Shows source + rate/as-of on expense surfaces where useful

Balances / reimbursements / settlements / stats remain ledger base currency only.

### Recurring expenses

Out of scope for special rate handling in this change. Recurring materialization may continue to copy conversion fields from the current frame. A later change can revisit re-resolving `EXCHANGE` per instance if needed.

## Risks / Trade-offs

- Provider outage blocks new `EXCHANGE` saves → clear error; `NONE` and `CUSTOM` continue.
- In-memory cache lost on restart → acceptable; expenses store the rate used; next lookup refetches.
- Balance path must convert original-currency `BY_AMOUNT` paidFor (not only paidBy) → requires careful updates to share/balance helpers and tests so Σ paidFor still equals Σ ledger amount.
- Existing rows lack `conversionSource` → migration default: if no original currency/rate → `NONE`; if original + rate present → `CUSTOM` (cannot prove exchange provenance).
- Concurrent group currency update vs first expense → enforce existence check in the same transaction as currency update.
- Deferred recurring re-resolution means long-lived recurring `EXCHANGE` series may keep an older rate on new instances until a follow-up change → accepted for v1 simplicity.

## Migration Plan

1. Document existing rate service as the exchange backend; no greenfield rate client.
2. Add `conversionSource` (and `conversionAsOf` if missing) via Prisma migration.
3. Backfill source for existing expenses (`NONE` vs `CUSTOM` as above).
4. Update domain schemas and balance math for original-currency share storage + server conversion.
5. Update expense create/update and import to resolve rates and compute ledger amount server-side.
6. Update web form to submit `conversionSource` + original inputs; wire existing rate actions with “exchange rate” wording + Frankfurter attribution note; add future-date messaging.
7. Block group currency changes after expenses exist.
8. Extend exports with `conversionSource` + as-of; keep accounting columns ledger-based.
9. Do not recompute historical ledger amounts except via normal edit.

## Open Questions

- None for initial implementation scope. Recurring exchange re-resolution and broader custom-currency product work are deferred.
