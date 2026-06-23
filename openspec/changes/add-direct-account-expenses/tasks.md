## 1. Backend Data Model

- [ ] 1.1 [Backend] Add DIRECT ledger schema details: canonical account pair, pending invited email participant, direct ledger status, and unique account-pair constraints.
- [ ] 1.2 [Backend] Add direct ledger base-currency creation with smart default from account preference or locale and manual override.
- [ ] 1.3 [Backend] Ensure pending invited-email direct ledgers can store expenses before invite acceptance and link to the matching account on acceptance.
- [ ] 1.4 [Backend] Enforce that direct ledgers cannot add third accounts or imported unlinked participant entries.

## 2. Backend API

- [ ] 2.1 [Backend] Implement direct ledger create-or-get procedure for existing account counterparties.
- [ ] 2.2 [Backend] Implement pending direct ledger creation for invited email counterparties.
- [ ] 2.3 [Backend] Implement invited email update before acceptance.
- [ ] 2.4 [Backend] Implement canonical navigation behavior: when a direct ledger already exists for the account pair, return/navigate to the existing ledger instead of creating another.
- [ ] 2.5 [Backend] Implement direct expense create, list, get, update, delete, recurrence, document, reimbursement, category, and activity operations using shared ledger expense tables.
- [ ] 2.6 [Backend] Implement direct balance summary and account direct relationship list queries.
- [ ] 2.7 [Backend] Implement direct ledger export and account-wide export inclusion.

## 3. Frontend Integration

- [ ] 3.1 [Frontend] Add direct relationship routes such as `/direct`, `/direct/$directLedgerId`, and direct expense create/edit routes.
- [ ] 3.2 [Frontend] Add direct counterparty selection by existing account search or invited email.
- [ ] 3.3 [Frontend] Add pending invited-email state handling, including edit-email-before-acceptance, invite-without-expense-details behavior, and accepted-account linking refresh.
- [ ] 3.4 [Frontend] Reuse expense form data contracts for direct expenses while constraining paid-by/paid-for participants to the two direct ledger participants.
- [ ] 3.5 [Frontend] Add direct export actions and wire account-wide export inclusion.
- [ ] 3.6 [Frontend] Add direct relationship pinning and ensure no direct archive action is exposed.

## 4. UI-Focused Handoff

- [ ] 4.1 [UI] Design direct relationship list UI with counterparty, net balance, pinned state, pending invited-email state, and recent activity.
- [ ] 4.2 [UI] Design direct relationship detail UI with expenses, balances, documents, recurrence visibility, export action, and create expense action.
- [ ] 4.3 [UI] Design direct expense create/edit UI adapted for two people while preserving group feature parity.
- [ ] 4.4 [UI] Design pending invited-email affordances, including editable invite email before acceptance, no expense details before authentication, and clear no-access-yet messaging.
- [ ] 4.5 [UI] Design empty and duplicate-navigation states when a user attempts to create a direct ledger that already exists.

## 5. Verification

- [ ] 5.1 [Testing] Add unit tests for direct ledger pair uniqueness and direct balance calculations.
- [ ] 5.2 [Testing] Add API tests for pending invited-email ledgers, invite email privacy, email update before acceptance, acceptance linking, and duplicate pair navigation.
- [ ] 5.3 [Testing] Add tests confirming direct ledgers do not appear in group lists and cannot add third participants.
- [ ] 5.4 [Testing] Add export tests for direct ledger export and account-wide export inclusion.
- [ ] 5.5 [Testing] Run `bun check-types`, `bun run test`, and targeted Playwright direct-expense specs.
