## Why

Users with existing expense data need a path into the account-backed product without manually recreating participants and expenses. The first supported source is existing Spliit groups, but the import architecture must be open enough to add Splitwise or other platforms later without rewriting the import workflow.

## What Changes

- Add an import flow where a user selects an import source, points to an existing group on `spliit.app`, or uploads exported JSON and imports its group, participants, expenses, splits, reimbursements, categories, notes, dates, currency data, and documents where available.
- Use a source-adapter pipeline so new providers such as Splitwise can be added later by implementing discovery, extraction, normalization, and validation adapters.
- Support both direct Spliit import by URL and Spliit import from exported JSON, using whichever source is available and reliable for the user.
- Let the importer create or adjust destination participant mappings before and during the wizard so each imported expense can map payer and paid-for shares deterministically.
- Handle source participants without accounts by creating unlinked participant entries during import only; those entries can participate in expenses and balances but cannot access the app.
- Let the importer/admin map imported people to existing accounts during import or after import, or deliberately leave departed/inactive people unlinked.
- Clearly separate authenticated group members from unlinked participant entries.
- Report import validation issues before writing, including unsupported split modes, missing users, invalid amounts, document fetch failures, duplicate participants, and currency/conversion gaps.
- Make imports idempotent or detect duplicate imports from the same source group to avoid accidental duplicate expenses.

## Capabilities

### New Capabilities

- `spliit-import`: Import source architecture plus Spliit source discovery, import preview, participant mapping, import execution, validation, and duplicate detection.
- `import-participant-mapping`: Mapping source participants to accounts or unlinked participant entries.

### Modified Capabilities

- `group-membership`: Must define how unlinked participant entries coexist with authenticated members without granting app access.
- `expenses`: Must define how imported and later edited expenses may reference unlinked participant entries.
- `cloud-group-sync`: Imported groups become normal cloud groups after import and use the same online source-of-truth path.

## Impact

- API: importer endpoints, source adapter orchestration, source fetch/parsing, dry-run preview, transactional final commit, and import audit records.
- Web: source selection, Spliit import-by-URL or JSON flow, mapping UI, validation results, and post-import review screen.
- Database: import records, source provider identifiers, source group identifiers, participant mappings, and unlinked participant entry records.
- Domain: provider-neutral import schemas and normalization for legacy Spliit data while preserving cents, basis points, and split semantics.
- Operations/legal: evaluate public API access, rate limits, terms of use, and document fetching behavior from `spliit.app`.
- Roadmap dependency: depends on `add-accounts-cloud-group-sync`; the key distinction is that only authenticated accounts can use the app, while imported participant entries can exist as expense parties without access.
