## Context

The new account-backed product requires authentication to use the app, but imported data may contain people who do not have accounts, have left the group, or should never be invited. The first source is existing Spliit groups, but the importer must establish a provider-neutral pattern so Splitwise or other platforms can be added later without replacing the import workflow.

This design depends on `add-accounts-cloud-group-sync` for accounts, group memberships, authorization, and cloud group source-of-truth semantics. It must support both direct import by `spliit.app` group URL and import from exported JSON when URL-based import is unavailable or unreliable. Splitwise import is not implemented in this change, but the import source architecture must make it a bounded adapter addition later.

## Goals / Non-Goals

**Goals:**

- Import an existing external expense group into a cloud group owned by the importer, with Spliit as the first implemented source.
- Establish a provider-neutral source adapter pipeline for future platforms such as Splitwise.
- Support source discovery from a `spliit.app` group URL and from exported JSON.
- Preview imported group metadata, participants, expenses, splits, reimbursements, categories, dates, notes, currency fields, and supported documents before writing.
- Let the importer create mappings before import and adjust mappings during the wizard if validation reveals issues.
- Let imported people be linked to accounts by admin decision during import or after import, or deliberately left unlinked.
- Preserve expenses that involve people who have left and should not join the new cloud group.
- Allow unlinked participant entries created by import to remain in imported groups and be linkable in the future.
- Make the final import write transactional, auditable, and duplicate-resistant.

**Non-Goals:**

- Circumventing `spliit.app` access controls or scraping private data the importer cannot access.
- Guaranteeing document import if source document URLs are inaccessible or terms disallow copying.
- Granting app access to unlinked participant entries.
- Automatically forcing every imported participant to create an account.
- Solving every old schema variant without validation failure paths.
- Implementing Splitwise import in this change.

## Decisions

### 1. Use a wizard with one final destination-group commit

The import UX should be a wizard-style flow:

1. Choose an import source.
2. Enter `spliit.app` URL or upload exported JSON for the Spliit source.
3. Fetch/parse and normalize source data.
4. Preview group, participants, expenses, and validation warnings/errors.
5. Map source participants to accounts or unlinked entries.
6. Confirm import.
7. Transactionally create the destination group and imported data.

There should be no visible intermediate destination group while the wizard is in progress. The server may persist an `ImportSession` for validation, duplicate detection, and audit, but the destination group should be created only during final commit.

Recommended models:

- `ImportSession(id, importerAccountId, sourceProvider, sourceType, sourceGroupId, sourceUrl, normalizedPayloadHash, createdAt, completedAt)`.
- `ImportParticipant(id, importSessionId, sourceParticipantId, sourceName, mappingMode, accountId?, destinationParticipantEntryId?)`.
- `ImportIssue(id, importSessionId, severity, code, path, message, resolutionState)`.
- `ImportSourceRecord(importSessionId, sourceRecordType, sourceRecordId, destinationRecordId)` for duplicate detection/audit.

Rationale: the lifecycle stays simple for users and avoids half-created groups, while still giving the server enough state to validate and prevent duplicates.

Alternatives considered:

- Single "paste URL and import immediately" action: too risky because participant mapping and unsupported data need review.
- Long-lived intermediate destination groups: more lifecycle complexity than this import needs.
- Fully client-side import: exposes source parsing complexity to the browser and weakens transactional guarantees.

### 2. Use provider-neutral normalized import records

Each source adapter should convert provider-specific data into internal normalized records before mapping or writing:

- `ImportedGroup`.
- `ImportedParticipant`.
- `ImportedExpense`.
- `ImportedExpensePaidFor`.
- `ImportedDocument`.
- `ImportedCategory`.

Normalize money to integer minor units and percentage splits to basis points, matching domain rules. Preserve provider name, original IDs, and raw source fragments in the import session for audit/debugging, but only write normalized data into cloud tables.

Rationale: source format can differ from destination schema, especially across Spliit versions or export formats.

Alternatives considered:

- Write directly from provider JSON into Prisma create calls: fragile and hard to validate.
- Convert entirely in the client: makes validation and idempotency harder.

### 3. Use source adapters plus an import pipeline

Use a small source-adapter pipeline rather than provider-specific import flows. The preferred pattern is a Strategy-style source adapter composed with shared importer services:

- `ImportSourceAdapter`: provider-specific discovery, extraction, and normalization.
- `ImportValidator`: shared validation visitor over normalized records.
- `ImportPlanner`: builds the destination write plan and participant mapping requirements.
- `ImportCommitter`: performs the transactional write from the normalized plan.

This is more appropriate than a command-per-provider implementation because most steps after normalization are shared. It is also simpler than a full visitor pattern for every provider object because adapters can normalize to one internal shape first.

Initial source adapters:

- `SpliitPublicUrlSource`: fetches from public endpoints behind a `spliit.app` group URL if available and acceptable.
- `SpliitExportJsonSource`: accepts exported JSON.
- Future adapters, such as `SplitwiseExportSource` or `SplitwiseApiSource`, can be added without changing mapping, validation, commit, or UI review logic.

Adapter contract:

- `canHandle(input)`.
- `discover(input)`.
- `fetchFullGroup(discovery)`.
- `normalize(sourcePayload): NormalizedImport`.

Rationale: direct URL import is the preferred user experience, but exported JSON must be supported as a reliable fallback and explicit import path.

Alternatives considered:

- Hardcode direct API fetch: fastest if it works, but high stability and policy risk.
- Require manual JSON only: reliable, but worse user experience.
- Implement separate importer workflows per provider: duplicates mapping, validation, duplicate detection, and commit behavior.

### 4. Participant mapping is explicit and can remain incomplete

For each source participant, the importer chooses one mapping mode:

- `LINK_ACCOUNT`: map to an existing account.
- `UNLINKED_PARTICIPANT`: keep unlinked as a named participant entry with no app access.
- `SKIP`: only allowed if no imported expenses reference that participant, or if skipping referenced expenses is explicitly selected.

Source participants are name-only from the importer's perspective. The UI should allow the importer to set mappings before import and revise mappings during validation when issues appear. It should also allow intentionally leaving people unlinked, especially members who left the original group and should not be invited.

Rationale: authenticated accounts are the only app users, but imported groups may still need named expense parties that do not have accounts.

Alternatives considered:

- Require every participant to map to an account or invite: too strict and blocks departed/inactive people.
- Import source participants as app users without authentication: violates the account-backed roadmap.

### 5. Represent unlinked participant entries separately from authenticated members

The destination schema needs a way for imported expenses and later edits to reference unlinked people without making them authenticated members.

Recommended approach:

- Add a group participant entry table that can represent either `ACCOUNT_MEMBER` or `UNLINKED_PARTICIPANT`.
- Account-backed participant entries point to authenticated accounts through group membership and can access the group according to membership rules.
- Unlinked participant entries have display names, can be referenced by expenses in imported groups, and have no login, permissions, notifications, or group access.
- New unlinked participant entries cannot be created after import; only the source participants imported by the wizard can remain unlinked.
- A participant entry can later be linked to an account only by an owner/admin mapping decision. If the selected account is not already a group member, the system should create or activate that account's group membership during linking.
- Group owners/admins can map or correct participant-entry mappings after import.

Rationale: imported groups must balance correctly even when some people are not cloud users. The presence of unlinked entries is sufficient; no separate migrating state is needed.

Alternatives considered:

- Create inactive `GroupMember` rows without accounts: simpler, but dilutes the "member means account" invariant.
- Rewrite historical expenses to the importer: corrupts history.

### 6. Commit creates group, participants, expenses, and mappings transactionally

During final commit:

1. Create destination cloud group.
2. Create active group members and account-backed participant entries for linked accounts.
3. Create unlinked participant entries for unlinked mappings.
4. Write imported expenses using destination participant entry IDs.
5. Write documents if supported.
6. Write import audit/source mapping records.

Rationale: expense writes need stable destination participant entry IDs, and the user should not see a partially imported group.

Alternatives considered:

- Create a normal group immediately and mutate it during mapping: exposes half-imported data.
- Write expenses outside a transaction: risks partial imports.

### 7. Unlinked entries remain linkable after import

After import:

- Linked accounts and accepted invitees can be active members.
- Unlinked participant entries appear in expense detail, balances, and history.
- Imported expenses remain editable, including payer/split edits involving unlinked entries, matching current group edit behavior.
- New expenses can use unlinked participant entries that were created during import.
- Users cannot create brand new unlinked participant entries after the import is committed.
- Unlinked participant entries can be linked later by an owner/admin selecting the account that should own the entry.
- Linking is a one-way operation: the ledger participant entry is migrated to account ownership and membership is created/activated if needed, after which its historical and future balances immediately become associated with that account and appear in account-level views such as the homepage.

Rationale: the import can complete without forcing every person into an account. Unlinked entries are not a workflow state; they are durable participant records until linked or left unlinked.

Alternatives considered:

- Add a separate import/linking group status: adds lifecycle complexity without a clear product purpose.
- Freeze all imported expenses forever: safe, but too restrictive for typo/category cleanup.
- Keep a reversible link/unlink model: more flexible, but harder to reason about than one-way account ownership.

### 8. Duplicate detection uses source identity and payload hash

Store source provider, source group identifier, source adapter type, and normalized payload hash. Before commit, check if the same importer or destination group has already imported the same source group/hash.

Import should support:

- `BLOCK_DUPLICATE`: default.
- `REIMPORT_AS_NEW`: explicit user action, creates a separate group.
- Future `MERGE_UPDATE`: out of scope until source delta semantics are known.

Rationale: accidental duplicate imports are likely and expensive to clean manually.

Alternatives considered:

- Blind imports: simple but dangerous.
- Automatic merge: hard without stable source update semantics.

### 9. Validation is strict before writes

Validation should catch:

- Missing or duplicate source participant IDs/names.
- Referenced participant has no mapping.
- Unsupported split modes.
- Invalid amount/currency/conversion data.
- Paid-for shares that do not match the source total semantics.
- Reimbursements that cannot map cleanly.
- Unsupported recurring expense fields.
- Document URLs that cannot be fetched or copied.
- Destination account conflicts, such as mapping two source people to the same account without confirmation.

Warnings can allow import with acknowledged data loss. Errors must block commit.

Rationale: import mistakes can permanently pollute financial history.

Alternatives considered:

- Best-effort import with logs: faster, but too risky for expense data.

## Risks / Trade-offs

- [Risk] Direct `spliit.app` URL import may be unstable or disallowed. -> Mitigate with source adapter abstraction and exported JSON fallback.
- [Risk] Provider-specific assumptions can leak into shared import logic. -> Mitigate with normalized import records and shared validation/commit services that do not depend on Spliit-specific fields.
- [Risk] Unlinked participant entries can be mistaken for app users. -> Mitigate by labeling them as unlinked, giving them no access, and separating participant entries from authenticated members in the UI.
- [Risk] Mapping UX can become complex for large groups. -> Mitigate with bulk actions, auto-suggest by email/name, and validation-driven fixes.
- [Risk] Imported data may not match new schema exactly. -> Mitigate with normalization, strict validation, and explicit warning acknowledgements.
- [Risk] Document import can fail independently from expense import. -> Mitigate with optional document import, per-document issues, and retry support.
- [Risk] Long imports can partially write data. -> Mitigate with transactional final commit and no visible destination group until commit succeeds.

## Migration Plan

1. Complete account/membership foundation and decide participant entry schema.
2. Add import session, participant mapping, issue, and source record tables with source provider metadata.
3. Implement source adapter interfaces plus shared validator, planner, and committer services.
4. Implement Spliit URL and JSON adapters on top of the shared import pipeline.
5. Add protected importer API procedures: create/parse session, update mappings, validate, commit, cancel.
6. Add import UI: URL/JSON input, preview, participant mapping, issue resolution, final confirmation, and post-import review.
7. Add transactional commit that creates group, identities, expenses, documents, and audit records.
8. Add duplicate detection and idempotency checks.
9. Add tests for unlinked participant behavior, mapping modes, validation failures, duplicate import, and authorization.

Rollback strategy: keep import feature disabled until stable. Completed imported groups are normal cloud data plus import audit records, so rollback should disable new imports rather than delete imported groups.

## Open Questions

- What source formats are actually available from `spliit.app`: public URL API, export JSON, both, or neither?
- What source shape should a future Splitwise adapter use first: exported file or API integration?
- Should imported group ownership default only to the importer, or can importer assign owners/admins during mapping?
- Should document import copy files into this app's storage or only preserve source links?
- Should import support partial import of selected expenses, or all-or-nothing only?
