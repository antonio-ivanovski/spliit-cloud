## 1. Backend Import Model

- [ ] 1.1 [Backend] Add import session, import participant mapping, import issue, and import source record models.
- [ ] 1.2 [Backend] Add support for imported unlinked LedgerParticipants created only by import commit.
- [ ] 1.3 [Backend] Enforce that new unlinked participants cannot be created after import commit.
- [ ] 1.4 [Backend] Add one-way admin mapping operation that migrates an unlinked LedgerParticipant to account ownership and creates/activates group membership if needed.
- [ ] 1.5 [Backend] Ensure linked imported participant balances immediately contribute to the linked account's group and overview totals.

## 2. Backend Source Adapters And Normalization

- [ ] 2.1 [Backend] Implement provider-neutral import source adapter interface returning a shared `NormalizedImport` model.
- [ ] 2.2 [Backend] Implement shared import validator, planner, and committer services that operate only on normalized records.
- [ ] 2.3 [Backend] Implement `spliit.app` URL discovery/fetch adapter where public access is available and acceptable.
- [ ] 2.4 [Backend] Implement Spliit exported JSON parser adapter.
- [ ] 2.5 [Backend] Normalize source groups, participants, expenses, paid-for rows, categories, notes, dates, reimbursements, recurrence, documents, and currency fields.
- [ ] 2.6 [Backend] Normalize imported amounts into destination Ledger base-currency minor units and preserve original amount, original currency, and conversion rate when available.
- [ ] 2.7 [Backend] Add adapter contract tests using a stub future provider to prove Splitwise-like providers can reuse the shared pipeline without provider-specific commit logic.

## 3. Backend Import Flow

- [ ] 3.1 [Backend] Add protected procedures for create/parse import session, preview normalized data, update participant mappings, validate, commit, and cancel.
- [ ] 3.2 [Backend] Validate missing participant mappings, duplicate participants, unsupported split modes, invalid amounts, currency gaps, conversion gaps, unsupported recurrence, and document failures.
- [ ] 3.3 [Backend] Implement duplicate detection by source provider, source identity, adapter type, and normalized payload hash.
- [ ] 3.4 [Backend] Implement transactional final commit that creates the group, Ledger, account-backed participants, unlinked participants, imported expenses, documents where supported, and audit/source records.
- [ ] 3.5 [Backend] Ensure import has no visible intermediate destination group before final commit succeeds.

## 4. Frontend Integration

- [ ] 4.1 [Frontend] Add import route and wizard state with source selection plus Spliit URL input or JSON upload.
- [ ] 4.2 [Frontend] Integrate import preview for group metadata, source participants, expenses, validation issues, and document warnings.
- [ ] 4.3 [Frontend] Add participant mapping controls for account mapping or leaving source participant unlinked by name.
- [ ] 4.4 [Frontend] Add final confirmation and post-import review navigation.
- [ ] 4.5 [Frontend] Add post-import admin mapping UI entry point for linking unlinked participants after import.
- [ ] 4.6 [Frontend] Ensure expense forms in imported groups can select imported unlinked participants but cannot create new unlinked participants.

## 5. UI-Focused Handoff

- [ ] 5.1 [UI] Design import wizard screens: provider/source selection, loading/discovery, preview, participant mapping, validation issue resolution, confirmation, and completion.
- [ ] 5.2 [UI] Design participant mapping rows for name-only source participants with clear states: linked account, unlinked, skipped when safe, and validation required.
- [ ] 5.3 [UI] Design unlinked participant labels throughout imported group views, balances, expense details, and expense forms so they are not confused with app users.
- [ ] 5.4 [UI] Design admin post-import linking flow with one-way migration confirmation and membership creation/activation messaging.
- [ ] 5.5 [UI] Design duplicate import warning and document import warning states.

## 6. Verification

- [ ] 6.1 [Testing] Add parser/normalization unit tests for Spliit URL adapter fixtures, Spliit exported JSON fixtures, and a stub future-provider adapter.
- [ ] 6.2 [Testing] Add validation tests for missing mappings, duplicate participants, split math, currency conversion preservation, and document failures.
- [ ] 6.3 [Testing] Add transactional commit tests for group/Ledger/participant/expense creation and duplicate detection.
- [ ] 6.4 [Testing] Add tests for no post-import unlinked participant creation and one-way admin participant linking.
- [ ] 6.5 [Testing] Add Playwright coverage for import wizard happy path, validation issue path, and post-import linking.
- [ ] 6.6 [Testing] Run `bun check-types`, `bun run test`, and targeted import Playwright specs.
