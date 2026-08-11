# Cloud Import review → Account export review

Goal: Preserve Cloud Import review outcome; next agent reviews **account export** (not re-litigate import).
Status: Cloud Import review closed (no findings). Next = account export review.

## Requirements and decisions

- [Decided] Spliit Cloud **group** import: unified `ImportGroupWizard`; dedicated `groups.importCloudBundle`; lossless manifest restore; new-group-only; currency step present but forced no-op; docs exact-byte staging.
- [Decided] Wrong-importer handoff retains `File`; account-scoped Cloud bundles rejected with “not available yet.”
- [Decided] No OpenSpec for this work.
- [Constraint] Bun only; do not start API/compose/storage unless user asks. DB-backed API suite needs existing Postgres.
- [Constraint] Never hand-edit `apps/web/src/messages/*` — use `bun i18n`.
- [Assumption] Account export review target ≈ `apps/api/src/lib/exports/account-export.ts`, `account-snapshot.ts`, `account-export.test.ts`, domain `export-manifest` ACCOUNT scope, plus any web/API surface that triggers account ZIP export.
- [Open] User has not yet attached an account-export plan — ask/wait for plan if review-against-plan is required.

## Current state — Cloud Import (verified)

- Review passes: **No findings** after final pending-clear + toast + wizard resume fixes.
- Key files: `apps/web/.../import/*` (wizard, reducer, documents, cloud-bundle, source-step), `apps/api/src/lib/api/import-cloud.ts`, `packages/domain/src/import/spliit-cloud.ts`, expense metadata migration.
- Validation claimed: 90 import tests, domain 870, cloud API unit 4, `bun run check`, i18n audit, `git diff --check`, React Doctor 84/100.
- Residual: full DB `importCloudGroup` not run (Postgres unavailable); intentional.

## Import invariants (do not break in export review)

- Group manifest `format: spliit.cloud/export` v1; optional participant `identity`; no invite tokens/secrets in export.
- Account-scope bundles classified but import deferred.
- Browser inspector limits: 256 MiB / 512 MiB expanded / 10k entries / 16 MiB manifest / 2 MiB doc.
- Export ↔ import contract lives in `packages/domain/src/export-manifest.ts`.

## Next review — Account export

- Change: Read-only defect review of account export implementation vs any user-supplied plan (and vs Cloud group export/import contract).
- Focus paths:
  - `apps/api/src/lib/exports/account-export.ts`
  - `apps/api/src/lib/exports/account-snapshot.ts`
  - `apps/api/src/lib/exports/account-export.test.ts`
  - `apps/api/src/lib/exports/archive.ts` / `group-snapshot.ts` (shared ZIP/docs)
  - `packages/domain/src/export-manifest.ts` (ACCOUNT scope)
  - Call sites / procedures that trigger account export
- Check against Cloud Import “Future Account Import” expectations: deduped identity directory, multi-group snapshots + prefixed docs, prefs, starred/hidden/default splits; **exclude** passwords, OAuth, sessions, push, notification deliveries, invitation secrets, idempotency/ops state.
- Notes: Prefer review-agent format (`[P1] title — path:line`). Do not start long-lived services. Do not commit unless asked.
- Verify: focused export tests + `git diff --check` as needed; no inventing OpenSpec.

## Acceptance

- Handoff enough for next agent to start account-export review without re-reading Cloud Import thread.
- Cloud Import treated as closed unless regressions found while reading shared export code.

## Risks / blockers

- Account-export plan not in this chat yet — may need user to paste plan before deep compliance review.

Next: Start read-only review of account export (`account-export.ts` / `account-snapshot.ts` / manifest ACCOUNT scope); request plan from user if reviewing against a written plan.
