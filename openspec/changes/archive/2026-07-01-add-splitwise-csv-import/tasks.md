## 1. Domain: Category Mapping

- [x] 1.1 Create `packages/domain/src/import/splitwise-categories.ts` exporting `splitwiseCategoryToId(name: string): CategoryId` plus the static Splitwise→Spliit category map covering all two-level tree leaves seen in the Splitwise UI (Entertainment, Food and drink, Home, Life, Transportation, Utilities, Uncategorized, Payment) and a hyphen-split fallback for custom strings like `Home - Other`.

## 2. Domain: Parser

- [x] 2.1 Create `packages/domain/src/import/splitwise-csv.ts` exporting `tryParseSplitwiseCsv(input: string): ImportParseResult`. Mirror `spliit-csv.ts`: strip UTF-8 BOM, use papaparse with `skipEmptyLines: 'greedy'`, validate the header (`Date,Description,Category,Cost,Currency,...`), skip `Total balance` rows, set `originalCurrency`/`originalAmount` per row, detect reimbursements via the `Payment` category or the `/^.+ paid .+ /` description regex, treat the positive-value column as the payer, apply the same drift-adjustment-on-largest-share trick for cent rounding, and output a `NormalizedSource` with `currency: 'MKD'`, `currencyCode: ''`, `sourceUrl: null`.
- [x] 2.2 Re-export `tryParseSplitwiseCsv` and `splitwiseCategoryToId` from `packages/domain/src/import/index.ts`.

## 3. Domain: Tests

- [x] 3.1 Create `packages/domain/src/import/splitwise-csv.test.ts` with cases modeled on `spliit-csv.test.ts`: a representative CSV with MKD and EUR rows, the `Total balance` skip, the `Payment` category reimbursement, the `paid` description regex reimbursement, the `Home - Other` custom category split, the per-row `originalCurrency` preservation, and the header-mismatch rejection. Cover the positive-value payer rule and the no-positive-value skip.

## 4. Web: Source Step UI

- [x] 4.1 In `apps/web/src/app/groups/import/source-step.tsx`, replace the `<TabsContent value="splitwise">` "coming soon" card with the same `FileUploadCard` used by Spliit. Render it when `provider === 'splitwise'` and pass through `isDragging`/`onDragOver`/`onDragLeave`/`onDrop`/`onFileChange`.
- [x] 4.2 Relax the drag handlers so they accept drops when `provider` is `'spliit'` OR `'splitwise'`.
- [x] 4.3 In `handleFile()`, dispatch the parser by the active provider and the file extension (`.json` → spliit JSON, `.csv` → provider's CSV parser). No bruteforce dual-parse.

## 5. Translations

- [x] 5.1 Run `bun i18n check` to confirm current state.
- [x] 5.2 Drop the "(coming soon)" suffix from `Groups.Import.Source.splitwise` in en-US (was "Splitwise (coming soon)" → "Splitwise") and propagate to all 23 non-en-US locales via `bun i18n set`.
- [x] 5.3 Add Splitwise-specific keys to en-US via `bun i18n add`: `dropFileSplitwise`, `dropFileDescriptionSplitwise`, `receiptWarningTitleSplitwise`, `receiptWarningDescriptionSplitwise`, `unsupportedFileType`. Propagate translations to all 23 locales via `bun i18n set` (parallel subagents grouped by language family).
- [x] 5.4 Run `bun i18n check` to confirm all locales are 100% in sync.

## 6. Specs & Docs

- [x] 6.1 Verify the parent `openspec/specs/spliit-import/spec.md` "Source step lists available providers" requirement matches the new `MODIFIED` delta (this should happen automatically when the change is archived).
- [x] 6.2 Add a "From Splitwise (CSV)" section to `docs/migration.md` parallel to the existing JSON/CSV/URL sections. Document the header shape, the `Total balance` skip, the `Payment` category, the multi-currency behavior, and the auto-detection.

## 7. Verification

- [x] 7.1 Run `bun check-types` and resolve any type errors.
- [x] 7.2 Run `bun run test` (Vitest unit tests) and confirm all new and existing tests pass.
- [x] 7.3 Run `bun i18n check` and confirm no missing keys across locales.