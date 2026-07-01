## Context

The Spliit import pipeline is built around `NormalizedSource` (`packages/domain/src/import/types.ts`): a parser produces it, the wizard walks it, `buildImportBatch()` resolves currencies against the destination ledger, and `groups.import` persists everything in one transaction. The pipeline is source-agnostic by design — only the parser differs per source.

Two parsers already exist: `tryParseSpliitExport()` for the JSON export and `tryParseSpliitCsv()` for Spliit's own CSV export. Both produce a `NormalizedSource` and feed straight into the existing wizard. The source step UI advertises Splitwise as a "coming soon" tab (a placeholder card) but no parser, no test, and no spec exist.

Splitwise's CSV export has a different shape from Spliit's:

```
Date,Description,Category,Cost,Currency,John Doe,Jane Doe
2026-01-14,Telekom 12.2025,General,1274.00,MKD,-1274.00,1274.00
2026-01-14,John D. paid Jane D.,Payment,136.80,EUR,136.80,-136.80
2026-06-30,Total balance,,,MKD,0.00,0.00
```

Distinguishing features:

- **Header order**: `Date,Description,Category,Cost,Currency,...` (Spliit has `Currency` in slot 3, Splitwise has it in slot 4 with `Cost` in slot 3).
- **Per-row currency** instead of a single group currency. The same CSV mixes MKD, EUR, USD across rows.
- **Signed per-participant cells**: the participant column with the positive value is the payer; negative values indicate what they owe.
- **"Payment" category** (and the `Description` pattern `/^.+ paid .+ /`) marks reimbursements.
- **`Total balance` rows** at the end of every export are noise.
- **Custom category strings** like `"Home - Other"` (from Splitwise exports) must be split on ` - `.
- **Two-level category tree** in Splitwise UI; Spliit stores a single id with a display `grouping`.

## Goals / Non-Goals

**Goals:**

- Parse Splitwise CSV exports into `NormalizedSource` so the rest of the import pipeline (wizard, mapping, batch, currency conversion, commit) works without modification.
- Map Splitwise's two-level categories to Spliit's in-code category ids with a documented static table; unknown → `'general'`.
- Detect reimbursements via either the `Payment` category or the `paid` description pattern.
- Allow multi-currency CSVs by populating `originalAmount`/`originalCurrency` per expense and letting the wizard's existing Frankfurter-backed conversion handle the rest.
- Wire the existing Splitwise tab in the source step to file upload, using the same drag-and-drop affordance as the Spliit tab.
- Maintain the source-step's tabbed UX: file format is auto-detected by header shape (the user doesn't have to pick "CSV = Spliit" vs "CSV = Splitwise").

**Non-Goals:**

- Splitwise API integration. CSV export only — no OAuth, no server-side fetch.
- Per-row currency picker. The wizard already asks for the destination ledger's base currency; the per-row `originalCurrency` is preserved automatically.
- Auto-detecting "which Splitwise group" a CSV came from. Splitwise's CSV export is per-account and has no group identifier — each file becomes one wizard commit and the user names the group at the destination step.
- Grouping multiple Splitwise CSVs into one Spliit group. One CSV = one wizard commit.
- Splitwise custom categories, Splitwise groups, or any feature not present in the CSV export.
- Tricount and Settle Up. Out of scope for this change.

## Decisions

### 1. One new parser file mirrors `spliit-csv.ts`

`packages/domain/src/import/splitwise-csv.ts` exports `tryParseSplitwiseCsv(input: string): ImportParseResult`. It uses the same papaparse setup, the same drift-adjustment-on-largest-share trick for cent-rounding, and the same `ImportParseResult` shape. The only differences from `spliit-csv.ts` are:

- Different `validateHeader()` (header slots differ — see Decision 2).
- Skip rows where `Description === "Total balance"` (footer noise).
- Per-row `originalCurrency` is read from the row, not the source-level default.
- Per-row `originalAmount` is computed as `Math.round(costMajor * 100)` and shares are absolute cents (same as Spliit's CSV).

Alternatives considered:

- Extend `tryParseSpliitCsv()` with a format flag — rejected: keeps two distinct formats in one function and obscures header detection.
- Add a new tRPC procedure for Splitwise — rejected: the existing `groups.import` already accepts whatever `NormalizedSource` produces.

### 2. Format detection by header slot order

`Date,Description,Category,Cost,Currency,...` is unambiguously Splitwise. `Date,Description,Category,Currency,Cost,...` is unambiguously Spliit. The parser function dispatch is decided by which header position holds `"Currency"`:

- slot 3 → Spliit
- slot 4 → Splitwise

In `source-step.tsx`, `handleFile()` runs both `tryParseSpliitCsv()` and `tryParseSplitwiseCsv()` when the file is `.csv`, takes whichever returns `{ ok: true }`, and surfaces the error of the failing one only when both fail. The header check inside each parser already rejects mismatched headers with a clear error, so the wrong parser simply returns `{ ok: false }`.

### 3. Category mapping table

`packages/domain/src/import/splitwise-categories.ts` exports `splitwiseCategoryToId(name: string): string` with a static `Record<string, CategoryId>` map. Custom strings with ` - ` (e.g. `"Home - Other"`) are split on ` - ` and the right-hand side is re-mapped; if the left-hand side itself is a top-level category, use it; otherwise fall back to `'general'`.

The map covers every leaf category in the user's exports (Entertainment, Food and drink, Home, Life, Transportation, Utilities, Uncategorized/General, Payment) plus the subcategories seen in screenshots and CSVs. Unknown → `'general'` so import never fails on a new Splitwise category.

Alternatives considered:

- Match by category `grouping + name` like `spliit.ts` does — rejected: Splitwise CSV exposes only the leaf name (the grouping is a UI concept, not in the export).
- Ask the user to remap unknown categories in the wizard — rejected: pushes complexity to UI for a corner case; `'general'` fallback is the right default.

### 4. Reimbursement detection via two signals

Treat a row as a reimbursement (`isReimbursement: true`) if either:

- `Category === "Payment"`, **or**
- `Description` matches `/^.+ paid .+ /` (e.g. `"Jane D. paid John D. ден610.00 for "Settleup Ljubanishta""`).

Both signals appear in the user's exports. The "Payment" category is the canonical Splitwise signal; the description pattern catches older entries that pre-date the category rename.

### 5. Multi-currency single CSV

Each row's `Currency` becomes the expense's `originalCurrency`. `Cost` (major units, e.g. `1274.00`) becomes both `amount` (cents in the row's currency) and `originalAmount` (cents in the row's currency — they start equal). The destination step's `GroupForm` already lets the user pick the ledger's base currency; if it differs from any row's currency, the existing `computeImportRateKeys()` + `getCurrencyRate()` path in `batch.ts` fetches the per-date rate and stores `conversionRate`.

The Splitwise source's `currency` field on `NormalizedSource` is set to `'MKD'` as a placeholder for Spliit's currency symbol; the `currencyCode` is set to the empty string `''` so the destination step forces the user to pick a real ledger currency. The per-row data carries the real currency.

Alternatives considered:

- Set `source.currencyCode` to the most common currency in the CSV — rejected: the user must explicitly choose the ledger currency; auto-picking hides intent.
- Reject the import if the CSV mixes currencies — rejected: Splitwise users commonly have multi-currency exports and forcing them to split files by currency is hostile.

### 6. Source-step UI swap

Replace the `<TabsContent value="splitwise">` placeholder card with the same `FileUploadCard` already used for Spliit. The component is already generic; it just needs to be rendered when `provider === 'splitwise'`. The `handleDragOver`, `handleDragLeave`, and `handleDrop` callbacks already short-circuit when `provider !== 'spliit'`; relax those to allow both `spliit` and `splitwise`.

The `handleFile()` function dispatches:

```ts
if (lowerName.endsWith('.csv')) {
  // Try Spliit first, then Splitwise — whichever succeeds wins.
  const spliit = tryParseSpliitCsv(text)
  if (spliit.ok) { onLoaded(spliit.source); return }
  const splitwise = tryParseSplitwiseCsv(text)
  if (splitwise.ok) { onLoaded(splitwise.source); return }
  onError(splitwise.error)  // most recent failure surface
  return
}
// JSON path is unchanged (Splitwise has no JSON export).
```

### 7. No server-side changes

`groups.import`, `importGroup()`, `buildImportBatch()`, `computeImportRateKeys()`, the wizard state, the mapping step, and the confirm step are all source-agnostic. They consume `NormalizedSource` and emit the existing `expenseApiSchema` payload. No new tRPC procedure, no new Prisma model, no new migration.

## Risks / Trade-offs

- **Header ambiguity for other CSV exports** — any tool that happens to use `Date,Description,Category,Cost,Currency` would be misclassified. Mitigation: the `tryParseSpliitCsv()` call runs first and rejects Spliit-shaped headers strictly; the Splitwise parser additionally checks for the absence of a `Currency` slot at index 3 before accepting. False positive is possible but unlikely in practice; surface both errors if both parsers fail.
- **Unknown Splitwise categories** silently fall back to `'general'` — Mitigation: the source's category list is shown in the preview step (already required by the spliit-import spec), so the user sees the categorization before commit and can fix it after import by editing each expense. Splitwise is a "best effort" importer.
- **Negative-share rounding drift** — Same as Spliit CSV: the parser adjusts the largest share to absorb rounding drift. With 2-person CSVs this never drifts more than 1 cent.
- **Per-row `originalCurrency` means cross-currency conversion runs per-date** — For a CSV with 200 expenses over 3 currencies spanning 5 years, that's up to ~600 Frankfurter lookups. Mitigation: `computeImportRateKeys()` deduplicates by `(date, base, target)`; in practice the count is in the dozens.
- **No way to detect "which Splitwise group" the CSV came from** — Mitigation: the destination step's `GroupForm` lets the user name the new group. The "Imported from Splitwise" note is pre-filled using `appendImportedFromNote(undefined, sourceUrl)` with `sourceUrl = null` because Splitwise CSVs have no per-group URL.

## Migration Plan

1. Add `splitwise-categories.ts` and `splitwise-csv.ts` plus tests in `packages/domain/src/import/`.
2. Re-export from `packages/domain/src/import/index.ts`.
3. Swap the Splitwise tab in `source-step.tsx` to use `FileUploadCard` with format detection in `handleFile`.
4. Run `bun i18n check` then update `en-US.json` and re-run `bun i18n sync` to propagate to other locales.
5. Update `openspec/specs/spliit-import/spec.md` (the parent spec) to remove the "coming soon" Splitwise clause.
6. Add a "From Splitwise (CSV)" section to `docs/migration.md`.

Rollback strategy: revert the source-step swap to show the "coming soon" card and remove the parser exports; no data migration is needed because nothing was persisted beyond what the existing `groups.import` already creates.

## Open Questions

- Should the Splitwise CSV carry a `sourceUrl` of `null` or something like `splitwise://export/<timestamp>` so `appendImportedFromNote` shows something useful in the group information field? Current proposal: `null` and let the user fill in the note manually.
- Should we accept ZIP exports of Splitwise (some users get one CSV per Splitwise group when they export via the web app)? Out of scope here, but worth filing as a follow-up.