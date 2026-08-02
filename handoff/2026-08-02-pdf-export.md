# Branded PDF expense export

Goal: Add a Spliit Cloud-branded PDF statement and redesign group Settings exports into clear, consistent PDF/CSV/JSON actions.
Status: ready to implement

Issue: https://github.com/antonio-ivanovski/spliit-cloud/issues/46

## Requirements and decisions

- [Decided] Generate a real `.pdf` on the API with `@json-render/react-pdf`; return it as a direct download. No browser Print / Save flow.
- [Decided] Build a typed `Spec` rooted at `Document`; render with `renderToBuffer`. Use standard `Page`, `Image`, `Row`, `Column`, `Heading`, `Text`, `Table`, `Divider`, `Spacer`, and `PageNumber` components.
- [Decided] Add a small custom catalog/registry for reusable branded `BrandHeader`, `MetricCard`, and `SectionHeader` components; compose all report content from data, never arbitrary client specs.
- [Decided] PDF branding: Spliit Cloud logo, emerald primary `#047857`, restrained coral accent, Spliit Cloud document metadata/footer, page numbers, clean light background, high-contrast tables.
- [Decided] Bundle `logo-with-text-email.png` as the PDF logo source; load once and pass to `Image` as a base64 data URI. Ensure the API production image includes the asset.
- [Decided] Page size = LETTER for `en-US`; A4 for other supported locales.
- [Decided] User selects inclusive `from` and `to`; defaults = earliest ledger entry through today. Empty group defaults both to today.
- [Decided] Period sections use regular expenses dated `from..to`: total, count, categories, participant paid/share totals, expense details.
- [Decided] Historical snapshot sections use every ledger entry dated `<= to`: balances, recorded reimbursements, suggested who-owes-whom transfers. `to=today` must match the current balances page.
- [Decided] Expense detail = date, title, category, group-currency total, payers + calculated paid amounts, participants + calculated owed amounts. Converted entries also show original amount/currency metadata.
- [Decided] Individual settlement only. No subgroup aggregation. No notes, attachments, or item-line expansion.
- [Decided] Current app locale controls report labels, category names, dates, currency, page direction/alignment, and filename.
- [Decided] Settings export UI = one card containing three equal-format export options: PDF report, CSV spreadsheet, JSON backup. Each option has icon, title, concise purpose, and explicit action button. No dropdown.
- [Decided] CSV/JSON endpoints, date scope, and included data remain unchanged. Only presentation/action discoverability changes.
- [Constraint] Money remains integer cents; `BY_PERCENTAGE` remains basis points. Reuse domain balance/share math; never calculate financial shares in the browser or PDF renderer.
- [Constraint] Active group membership required, matching JSON/CSV authorization.
- [Constraint] Use Bun. Never hand-edit `apps/web/src/messages/*`; use the `bun i18n` workflow.

## Current state

- [Verified] Existing downloads: `apps/api/src/routes/export-csv.ts`, `export-json.ts`; mounted in `apps/api/src/app.ts`.
- [Verified] Existing settings export UI: `apps/web/src/app/groups/[groupId]/edit/edit-group.tsx` renders a card containing dropdown-based `export-button.tsx` for both admins and members.
- [Verified] Suitable brand asset: `apps/web/public/logo-with-text-email.png`, transparent PNG, 500×151.
- [Verified] Canonical math: `packages/domain/src/balances.ts` (`getBalances`, `getPublicBalances`, `getSuggestedReimbursements`) and `packages/domain/src/totals.ts` (`calculateShares`, `calculatePaidByShares`).
- [Verified] Balance query precedent: `apps/api/src/trpc/routers/groups/balances/list.procedure.ts`; category/participant aggregation precedent: `apps/api/src/trpc/routers/groups/stats/`.
- No PDF implementation or validation completed.

## Architecture and interfaces

- Add API dependencies with Bun: `bun add --cwd apps/api @json-render/core @json-render/react-pdf`.
- Add `groups.reports.bounds({ groupId })` tRPC query for dialog defaults.
- Add authenticated `POST /groups/:groupId/expenses/export/pdf`:
  - request: `{ from, to, locale, labels }`;
  - `from`/`to`: inclusive `YYYY-MM-DD`;
  - `locale`: supported Spliit locale only;
  - `labels`: fixed Zod schema of already-localized report headings, column labels, empty-state text, and category-name map; apply conservative string-length limits. Client supplies these from i18next so API does not duplicate web translation catalogs.
  - response: `application/pdf`, attachment filename `Spliit Cloud - <group> - <from> - <to>.pdf` via `content-disposition`.
- Data flow: settings action → date dialog → web builds localized labels → credentialed POST → API authenticates and builds financial report model → formatter converts dates/currency to strings → JSON `Spec` builder → `renderToBuffer` → Blob download in browser.
- Keep layers separate:
  - `buildExpenseReport(...)`: pure integer-cent financial model;
  - `formatExpenseReport(model, locale, labels)`: renderer-ready strings and direction;
  - `buildExpenseReportSpec(viewModel, logoDataUri): Spec`: deterministic layout only;
  - route: validation/auth/data access/render/headers only.

## Tasks — execute in order

### 1. Add dependencies, logo asset, and PDF catalog

- Change: install `@json-render/core` + `@json-render/react-pdf` in `apps/api` using Bun.
- Change: add an API-owned copy of `logo-with-text-email.png`; update the API Docker/runtime copy step so source and bundled production runs resolve the same explicit path. Convert to a cached base64 data URI at runtime.
- Change: define catalog with `standardComponentDefinitions` plus Zod-defined `BrandHeader`, `MetricCard`, `SectionHeader`; register React PDF implementations with `defineRegistry`.
- Notes: use server-safe schema/catalog imports where React is unnecessary. Do not expose catalog/spec input publicly.
- Verify: type check; asset loads in source + bundled runtime tests; registry accepts a minimal branded spec.

### 2. Build and test report financial data

- Change: implement date parser, membership guard, bounds query, database loader, and pure `buildExpenseReport`.
- Model output:
  - group + ledger currency metadata; normalized period/as-of dates;
  - period `{ total, expenseCount, categories[] }`;
  - participants `{ id, name, removed, periodPaid, periodShare, balanceAsOf }`;
  - suggested settlements `{ from, to, amount }`;
  - recorded reimbursements through `to` with date/from/to/amount;
  - selected regular expenses ordered date then creation time, with category ID, group amount, optional original conversion metadata, calculated payer amounts, calculated participant shares.
- Notes: query rows only through end-of-`to`; derive `from..to` regular-expense subset in memory. Resolve active, pending, and removed referenced participants. Use `toBalanceExpense`, `getBalances`, `getPublicBalances(getSuggestedReimbursements(...))`, `calculatePaidByShares`, `calculateShares`. Category totals exclude reimbursements.
- Cases: reimbursement before/inside/after period; expense after `to`; settled/unsettled; empty group; removed participant; EVENLY, BY_PERCENTAGE, BY_AMOUNT, ITEMIZED, multi-payer, cross-currency, rounding residuals.
- Verify: focused Vitest suite; integer amounts; payer/share sums equal expense amount; `to=today` public balances and suggested legs equal `groups.balances.list` for identical rows.

### 3. Format and build the branded JSON PDF spec

- Change: create locale-aware view model and deterministic `Spec` builder.
- Document structure:
  1. `Document`: localized title, Spliit Cloud author/creator/subject metadata.
  2. `Page`: locale-selected A4/LETTER size, mirrored alignment for RTL, consistent margins.
  3. Branded header: logo, report title, group name, period, balance-as-of date, generation date, emerald divider.
  4. Metric row: period total, regular-expense count, participant count.
  5. Category totals table.
  6. Participant paid/share table.
  7. As-of balances + suggested settlement table.
  8. Recorded reimbursements through `to`.
  9. Expense details with payer/share tables and optional conversion note.
  10. Branded footer + `PageNumber` current/total.
- Notes: headings must explicitly distinguish “selected period” from “balance as of”. Use standard `Table` with explicit percentage widths/right-aligned amounts. Use custom components only for repeated brand primitives. Handle empty sections with localized `Text`, not empty tables. Sanitize/truncate unbounded display strings before spec construction. Avoid remote assets and links during rendering.
- Verify: spec unit tests assert `Document` root, page size/direction, logo `Image`, brand colors, section order, tables, empty states, footer, and page numbers.

### 4. Add authenticated PDF route

- Change: mount `POST /groups/:groupId/expenses/export/pdf` in `apps/api/src/app.ts`; validate body, locale, date ordering, label keys/lengths; require ACTIVE membership.
- Change: call report loader → formatter → spec builder → `renderToBuffer(spec, { registry })`; return binary bytes with `Content-Type`, safe attachment `Content-Disposition`, and `Cache-Control: private, no-store`.
- Error behavior: 400 invalid body/date/locale; 401 unauthenticated; 403 inactive/non-member; 404 missing group/ledger; 500 rendering failure through existing centralized logging. Never return partial PDF bytes.
- Verify: route tests mock renderer for auth/validation/headers/filename; one integration-style fixture uses real renderer and asserts `%PDF-` magic bytes, non-empty body, embedded Spliit metadata/logo, and extractable expected text.

### 5. Redesign the Settings export card

- Change: replace dropdown `ExportButton` with reusable `ExportOptionsCard`/`ExportOption` components rendered once from `edit-group.tsx` for admins and members.
- Layout:
  - existing section title + clearer description;
  - responsive one-column list on mobile, three equal-height columns at desktop;
  - each option: tinted icon well, format title, one-line use case, format badge, bottom-aligned full-width or clearly trailing action;
  - PDF: `FileText`/brand accent, “Create PDF” action;
  - CSV: spreadsheet icon, “Download CSV” action;
  - JSON: braces/file icon, “Download JSON” action;
  - equal visual weight, shared hover/focus/disabled treatment, minimum 44px touch targets, no hidden dropdown actions.
- Behavior: CSV/JSON retain current URLs, target, and full-history contents. PDF opens the date dialog; no CSV/JSON date or inclusion controls in this change.
- Verify: RTL tests for all three visible options/actions, correct CSV/JSON hrefs, keyboard order, responsive classes, member/admin visibility, PDF dialog opening, loading/disabled states.

### 6. Add PDF dialog and browser download flow

- Change: on PDF action, load bounds; show accessible responsive dialog with required `from`/`to`, defaults, inline ordering validation, cancel, and primary Generate PDF.
- Change: construct fixed localized-label payload from i18next, including category IDs; credentialed fetch POST; read Blob; derive filename from `Content-Disposition` or fallback; trigger temporary `<a download>`; revoke object URL.
- UX: generating state with spinner + disabled submit; keep dialog open on error with localized retryable message; close after download starts; toast success/failure. Empty groups still produce a branded zero-state PDF.
- Verify: web tests for defaults, validation, exact request body, credentials, Blob download, filename fallback, URL revocation, success/error states, and duplicate-submit prevention.

### 7. Translate and validate

- Change: add English export-option, dialog, report-label, empty-state, and error strings via `bun i18n`; never edit message JSON directly.
- Commands: `bun i18n plan --json`; execute returned mode/batches; `bun i18n check --changes-only`.
- Verify: focused API/web tests; `bun run check-types`; `bun run lint`; `bun run check-formatting`; relevant `bun test` filters. Do not start API or long-lived services.
- Visual verification: render fixtures for short/long, A4/LETTER, RTL, CJK, converted, and empty reports; inspect every page for wrapping, clipping, logo quality, table readability, footer placement, and missing glyphs.

## Acceptance

- Settings shows a polished, consistent export card with immediately visible PDF, CSV, and JSON actions on mobile and desktop.
- CSV/JSON downloads behave exactly as before.
- Active member can select dates and directly download a valid `.pdf` without a print dialog.
- PDF is recognizably Spliit Cloud: logo, emerald/coral visual system, metadata, branded footer, and page numbers.
- Period spending/category/person details and expense payer/share breakdowns are localized and financially correct.
- Balances/reimbursements/transfers are an as-of-`to` snapshot; today matches the balances page exactly.
- Removed/historical participants, all split modes, cross-currency entries, empty groups, RTL, and supported scripts render correctly.
- No database migration. Tests, type/lint/format checks, PDF visual verification, and i18n parity pass.

Next: implement Task 1 catalog/dependencies/brand asset, then Task 2 pure report model before touching UI.
