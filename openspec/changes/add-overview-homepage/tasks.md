## 1. Backend Overview API

- [ ] 1.1 [Backend] Add protected overview router/procedure returning account profile, group summaries, direct summaries, aggregate balances, recent expenses, recent activity, and quick-action metadata.
- [ ] 1.2 [Backend] Compute overview totals from accessible ledgers server-side without returning full historical expense lists.
- [ ] 1.3 [Backend] Include linked imported participant balances in account totals after one-way participant linking.
- [ ] 1.4 [Backend] Add bounded recent expense and recent activity queries with stable ordering and configurable limits.
- [ ] 1.5 [Backend] Add account-scoped group preference APIs for pin/star/archive/hide as needed by overview.
- [ ] 1.6 [Backend] Add direct relationship pin preference support and explicitly omit direct archive support.

## 2. Backend Archive Semantics

- [ ] 2.1 [Backend] Implement account-scoped group archive operation that only succeeds when the current account's group balance is zero.
- [ ] 2.2 [Backend] Implement force-archive operation that creates a normal reimbursement expense with archival title/note bringing the current account's group balance to zero before archiving.
- [ ] 2.3 [Backend] Ensure group archive does not remove membership, affect other members, or archive the group globally.
- [ ] 2.4 [Backend] Add audit/activity records for archive and force-archive reimbursement creation.

## 3. Frontend Integration

- [ ] 3.1 [Frontend] Replace signed-in homepage content with overview query integration while preserving signed-out landing/sign-in state.
- [ ] 3.2 [Frontend] Render server-backed group summaries instead of browser-local recent group data.
- [ ] 3.3 [Frontend] Render direct relationship summaries, pinned direct relationships, and pending direct relationships when available.
- [ ] 3.4 [Frontend] Add overview quick actions for create group, create direct expense, import Spliit group, and pending invitations.
- [ ] 3.5 [Frontend] Wire group archive UI to block unsettled balances and expose force-archive settlement flow.

## 4. UI-Focused Handoff

- [ ] 4.1 [UI] Design authenticated homepage dashboard layout optimized for scanning balances, groups, people/direct relationships, recent expenses, and recent activity.
- [ ] 4.2 [UI] Design signed-out, loading, empty signed-in, populated signed-in, and error states.
- [ ] 4.3 [UI] Design group summary rows/cards with balance, role/status, pinned/starred/archived presentation, and action affordances.
- [ ] 4.4 [UI] Design direct relationship summary rows/cards with pinned state and no archive action.
- [ ] 4.5 [UI] Design group archive blocked state and force-archive confirmation, including the generated reimbursement title/note explanation.
- [ ] 4.6 [UI] Design responsive behavior for dashboard sections without using browser-local data as source of truth.

## 5. Verification

- [ ] 5.1 [Testing] Add API tests for overview aggregation, bounded recent data, linked import balances, and account-scoped preferences.
- [ ] 5.2 [Testing] Add API tests for group archive blocking, force archive reimbursement creation, and per-account archive isolation.
- [ ] 5.3 [Testing] Add Playwright coverage for signed-out, empty signed-in, populated signed-in, direct summaries, and archive force flow.
- [ ] 5.4 [Testing] Run `bun check-types`, `bun run test`, and targeted homepage Playwright specs.
