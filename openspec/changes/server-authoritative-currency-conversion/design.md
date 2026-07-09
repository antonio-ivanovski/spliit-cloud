## Context

Spliit already proxies exchange-rate lookup through the API:

- tRPC `currency.getRate` for expense-form preview
- Hono `POST /currency/rates` for bulk/import preview
- `apps/api/src/lib/currency-rates.ts` — Frankfurter client, in-memory cache, tests

The browser does **not** call the FX provider directly. Conversion **application** for persistence is server-authoritative.

Domain primitives from `unified-expense-calculation` are reused: `convertByRate`, `distributeRemainder`, balance engine cross-currency paths.

## Goals / Non-Goals

**Goals:**

- Make the API authoritative for conversion math on expense create/update and import.
- Model conversion as a **Zod discriminated union** on the API contract (`none` | `custom` | `exchange`) — no `NONE` enum value.
- Persist conversion provenance as nullable `conversionSource` (`EXCHANGE` | `CUSTOM`); null means same currency.
- Keep user-entered amount, shares, and items in a single expense currency per expense.
- Derive ledger-currency values server-side from original inputs + resolved rate.
- Resolve `EXCHANGE` rates by expense date (today for future-dated expenses).
- Block ledger base-currency changes after expenses exist.
- Flat DB columns (no JSON blob for money).

**Non-Goals:**

- Full ledger rebasing.
- Redis / distributed cache.
- `conversionAsOf` audit field (removed — expense date + rate snapshot is enough).
- Recurring-instance exchange re-resolution.
- Redesigning the rate UI from scratch.

## Decisions

### Discriminated union on the API contract (optional field)

Shared in `packages/domain/src/conversion.ts`:

```ts
// conversionSourceSchema = z.enum(['EXCHANGE', 'CUSTOM'])
// expenseConversionInputSchema = discriminatedUnion('type', [custom, exchange])
// optionalExpenseConversionSchema = expenseConversionInputSchema.optional()

// expenseApiSchema.conversion is optional:
//   undefined  → same currency as group/ledger (DB null)
//   { type: 'custom', currency, rate }
//   { type: 'exchange', currency }  // rate is server-resolved
```

Submitted `amount` is always expense-currency minor units. The server computes ledger `Expense.amount`. No `{ type: 'none' }` variant.

### Flat DB columns (no JSON)

| Column | Same currency | Converted |
|--------|---------------|-----------|
| `amount` | ledger (= input) | ledger (server-computed) |
| `originalAmount` | null | input minor units |
| `originalCurrency` | null | expense currency |
| `conversionRate` | null | snapshot rate |
| `conversionSource` | **null** | `EXCHANGE` \| `CUSTOM` |

No `NONE` enum value. No `conversionAsOf` column.

### Rate date rules

```
                 expenseDate ≤ today              expenseDate > today
EXCHANGE         rate for expense date            rate for **today**
CUSTOM           use submitted rate
none (null)      no rate
```

### Form mapping

Form keeps local fields (`originalCurrency`, `conversionRate`, `conversionType: EXCHANGE|CUSTOM`).
`buildSubmitValues` maps them to the `conversion` discriminant.

### Import

`buildImportBatch` sends expense-currency amounts + `conversion` discriminant.
Import persistence uses the same `resolveConversion` as create.

## Risks / Trade-offs

- Import EXCHANGE re-fetches rates (preview may differ slightly from final) — by design for server authority.
- Flat DB cannot enforce union invariants at the SQL layer; Zod + server resolver do.

## Migration

Clean migration `20260709120000_conversion_source`:

```sql
CREATE TYPE "ConversionSource" AS ENUM ('EXCHANGE', 'CUSTOM');
ALTER TABLE "Expense" ADD COLUMN "conversionSource" "ConversionSource";
```

No backfill of `NONE`. No `conversionAsOf`. Local DBs may be dropped and re-migrated.
