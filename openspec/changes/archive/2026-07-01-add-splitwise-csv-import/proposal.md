## Why

Spliit already ships a complete import pipeline that accepts Spliit JSON, Spliit CSV, and `spliit.app` URLs through a five-step web wizard. The source step advertises Splitwise, Tricount, and Settle Up as "coming soon" but the import pipeline has no parser, no UI flow, and no spec for any of them. Users currently migrating away from Splitwise have no path into Spliit other than retyping expenses by hand.

This change closes that gap for Splitwise by adding a CSV parser and wiring the existing Splitwise tab into the file-upload flow. The wizard, tRPC commit procedure, business logic, currency conversion, and participant mapping are reused unchanged — this is a parser + UI-swap change, not a new feature surface.

## What Changes

- Add `tryParseSplitwiseCsv()` in `@spliit/domain/import` that turns a Splitwise CSV export into the existing `NormalizedSource` shape.
- Add `splitwiseCategoryToId()` helper plus a static Splitwise-to-Spliit category map (Splitwise categories are a 2-level tree; Spliit stores a single id with a display `grouping`).
- Wire the existing Splitwise tab in the source step to the same `FileUploadCard` already used for Spliit; the file handler detects whether a `.csv` file is Spliit or Splitwise by header shape and dispatches to the right parser.
- Update `apps/web/src/messages/en-US.json` (and propagate via `bun i18n`) so the Splitwise tab shows real descriptions instead of "coming soon".
- Update `openspec/specs/spliit-import/spec.md` to remove the "coming soon" placeholder requirement for Splitwise and reference the new `splitwise-import` spec.

No database migration. No new tRPC procedure. No change to the wizard state machine, mapping step, confirm step, or `groups.import` mutation.

## Capabilities

### New Capabilities

- `splitwise-import`: Splitwise CSV format, parser behavior, category mapping rules, reimbursement detection, and multi-currency handling. Reuses `NormalizedSource`, `groups.import`, and the existing import wizard end-to-end.

### Modified Capabilities

- `spliit-import`: The "Source step lists available and coming-soon providers" requirement changes — Splitwise is no longer a "coming soon" tab; it now has a real file-upload flow alongside Spliit. The wizard-level requirements (5 steps, server-side commit, atomic import, cross-currency conversion, etc.) are unchanged.

## Impact

- Domain package: 2 new files (`splitwise-csv.ts`, `splitwise-categories.ts`), 1 new test file (`splitwise-csv.test.ts`), re-export added in `packages/domain/src/import/index.ts`.
- Web: `apps/web/src/app/groups/import/source-step.tsx` branches on header detection in `handleFile`, allows drag-and-drop when `provider === 'splitwise'`, drops the coming-soon card.
- Translations: 1 source key change in `en-US.json`, then `bun i18n sync` (per AGENTS.md, locale files are never hand-edited).
- Docs: `docs/migration.md` gains a "From Splitwise (CSV)" section parallel to the existing JSON/CSV/URL sections.
- Specs: new `openspec/changes/add-splitwise-csv-import/specs/splitwise-import/spec.md`; delta update to `openspec/specs/spliit-import/spec.md`.

No API change. No schema change. No new dependencies (papaparse is already a dependency).