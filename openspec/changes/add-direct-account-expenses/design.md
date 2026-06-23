## Context

The product currently models every expense inside a `Group`. Direct expenses are requested as account-to-account expenses that are not group based from the user's perspective. This design depends on `add-accounts-cloud-group-sync` for authenticated accounts, sessions, and stable account IDs.

The main architectural choice is whether direct expenses should be hidden two-member groups, dedicated direct-expense tables, or the same accounting core as groups through a generalized ledger model.

## Goals / Non-Goals

**Goals:**

- Let one authenticated account create expenses directly with another authenticated account.
- Keep direct expenses out of the visible group list and group navigation.
- Reuse money, split, reimbursement, category, notes, recurrence, document, and balance behavior with feature parity to groups where the feature applies to two accounts.
- Provide direct balances between two accounts.
- Keep authorization simple: only the two participating accounts can view or mutate a direct ledger.
- Leave a clean path for homepage aggregation and import/reporting.

**Non-Goals:**

- Supporting direct expenses with unauthenticated counterparties or imported unlinked participant entries.
- Building a chat/messaging product around direct relationships.
- Supporting more than two active accounts in a direct ledger. If there are more than two, it is a group, and users cannot add others to an existing direct ledger.
- Replacing groups with direct ledgers.
- Designing external payment settlement integrations.

## Decisions

### 1. Introduce the `Ledger` abstraction

Use the name `Ledger` for the shared accounting core. Create a `Ledger` model with a `type` enum:

- `GROUP`: backs normal groups.
- `DIRECT`: backs a pair of accounts.

Groups keep their product-specific metadata in `Group`, but expenses and activities attach to `ledgerId`. Direct ledgers have a `DirectLedger` or `LedgerParticipant` relation that records the two participating accounts.

Recommended shape:

- `Ledger(id, type, createdAt, updatedAt, version)`.
- `Group(id, ledgerId, name, settings...)`.
- `DirectLedger(id, ledgerId, accountAId, accountBId, createdByAccountId, status...)`.
- `LedgerMember(id, ledgerId, accountId, role/status/displayNameSnapshot...)` or reuse `GroupMember` only for group ledgers and a parallel direct participant table.
- `Expense(ledgerId, paidByLedgerMemberId, ...)`.
- `ExpensePaidFor(expenseId, ledgerMemberId, shares)`.

Every group, including imported groups, should have a `Ledger` from day one. Direct expenses and group expenses should use the same accounting core for expenses, balances, documents, recurrence, activity, and exports. The direct relationship should be "group-like" internally only at the accounting layer, not a hidden `Group` row. A real hidden group still has group semantics that must be suppressed everywhere: group name, member roles, invitations, adding members, group list visibility, import behavior, share links, and group settings.

Alternatives considered:

- Hidden two-person groups: closest to the original shadow-group idea and easiest with current group-first code, but direct relationships will leak into group list, roles, invites, import, export, and dashboard logic unless every query filters synthetic groups forever. This creates "same balances as group" by reusing the wrong product abstraction.
- Dedicated `DirectExpense` table: clean UI boundary, but duplicates forms, documents, recurrence, balances, exports, and activity behavior.

### 2. Keep direct ledgers pairwise and unique

There should be at most one active direct ledger for an unordered pair of accounts. Enforce uniqueness by canonical pair ordering:

- `accountAId` is lexicographically smaller than `accountBId`, or use a deterministic `pairKey`.
- Unique index on `(accountAId, accountBId)`.

Rationale: users expect all direct expenses with the same person to live in one relationship history and one balance.

Alternatives considered:

- Allow multiple direct ledgers per pair: supports contexts like trips, but that is what groups are for.
- Create one ledger per expense: makes balances and history unnecessarily fragmented.

### 3. Use two-member splits by default, with constrained split modes

Direct expenses should support feature parity with group expenses:

- `EVENLY`.
- `BY_AMOUNT`.
- `BY_PERCENTAGE`.
- `BY_SHARES`.
- Reimbursement/settlement entries.
- Notes.
- Categories.
- Documents.
- Recurrence.

In all cases, paid-by and paid-for rows should only reference the two ledger participants.

Rationale: direct expenses should not become a second-class expense type. Feature parity keeps the implementation and user expectations aligned.

Alternatives considered:

- Only support 50/50 direct expenses: too limited for real-world direct debts.
- Support the full group form unchanged: fast, but the UI should still be tailored to two people even if the underlying fields match group expenses.

### 4. Counterparty must be an authenticated account or accepted invite

A direct expense can be created with:

- An existing account selected by email/search.
- An email invite that becomes a pending direct ledger until the invited account accepts.

No imported unlinked participant entry is allowed for new direct expenses. If the counterparty is invited by email, the system may create a pending direct ledger and record expenses against the invited email before acceptance so the app can be used asynchronously. The inviter may change the invited email until acceptance. The invite email should not include expense details before authentication. The invited email has no app access until authentication, but after accepting with the matching email the pending participant becomes linked to that account and the existing direct expenses appear in that account's balances. Once a canonical direct ledger exists for two accounts, attempts by either account to create a new direct ledger with the other account must navigate to the existing ledger.

Rationale: this aligns with asynchronous friend-to-friend usage while keeping app access authenticated.

Alternatives considered:

- Allow free-text counterparties without email: conflicts with account linking and async acceptance.
- Auto-create full accounts for emails: creates privacy and lifecycle problems.

### 5. Direct ledger authorization is participant-only

Only the two ledger accounts can view, create, update, delete, or settle expenses. There are no owners/admins in direct ledgers, and users cannot add a third account to the ledger. Either party can add expenses and settlements. Destructive edits should create activity records visible to both.

Edit policy should match current group behavior:

- Expenses remain editable permanently by authorized participants.
- No counterparty approval or acknowledgement workflow is required.
- Users are expected to resolve disputes outside the app, or through future comments if comments are added later.

Rationale: this is an expense-sharing app between trusted friends, not a banking or enterprise approval system.

Alternatives considered:

- Require explicit approval for every expense: high friction.
- Add amendment-only accounting: too heavy for this product stage.

### 6. Balance APIs should operate on ledgers

Extract group balance operations so they can calculate by `ledgerId`:

- `getLedgerExpenses(ledgerId)`.
- `getLedgerBalances(ledgerId)`.
- `getAccountDirectBalances(accountId)`.
- `getAccountLedgerSummaries(accountId)`.

For direct ledgers, the balance result should be simplified to one counterparty amount:

- Positive means the current account is owed money.
- Negative means the current account owes money.

Rationale: homepage and direct detail views need account-centric summaries, not group-centric participant arrays.

Alternatives considered:

- Keep separate direct balance math: risks divergence from group behavior.
- Force direct balances into group UI structures: awkward for API consumers.

### 7. UI should expose direct expenses as relationships, not groups

Add routes such as:

- `/direct`: list direct relationships and balances.
- `/direct/$directLedgerId`: relationship detail.
- `/direct/$directLedgerId/expenses/create`.
- `/direct/$directLedgerId/expenses/$expenseId/edit`.

The homepage can show direct summaries, but direct ledgers must not appear as normal groups.

Rationale: product semantics should match the user request: "not group based."

Alternatives considered:

- Reuse `/groups/:groupId` with hidden groups: leaks implementation and confuses navigation.

### 8. Direct ledgers support direct and account-wide exports

Direct ledgers should be exportable with the same data fidelity as group ledgers. Export entry points should include:

- Direct relationship export from the direct ledger detail page.
- Account-wide export that can include group ledgers and direct ledgers.

Rationale: feature parity means direct expenses are not trapped in the UI and can be reported/exported like group expenses.

Alternatives considered:

- Only support group exports: makes direct expenses a second-class record type.
- Only support account-wide export: misses the common need to export a single relationship.

## Risks / Trade-offs

- [Risk] Generalizing to ledgers touches the existing group schema and many APIs. -> Mitigate by sequencing after account/membership and by preserving group routes as wrappers around ledger queries.
- [Risk] Hidden group alternative is faster. -> Mitigate by documenting that the desired reuse is accounting reuse, not reuse of group product semantics.
- [Risk] Permanent edits can allow one participant to alter shared history unexpectedly. -> Mitigate by keeping activity records visible to both participants and revisiting comments/audit depth later if needed.
- [Risk] Pending invites complicate balance visibility. -> Mitigate by showing pending direct expenses only to the inviter until the invited email authenticates, then associating the pending ledger participant and balances with that account.
- [Risk] Direct expenses can duplicate small two-person groups. -> Mitigate with clear UI separation: direct for ongoing person-to-person balances, groups for shared contexts/trips/households.

## Migration Plan

1. Complete account and membership foundation.
2. Add `Ledger` schema and migrate existing groups to `GROUP` ledgers.
3. Point group expenses and activities at `ledgerId` while preserving group route behavior.
4. Add direct ledger schema with unique account pair constraints.
5. Add direct expense and direct balance API procedures.
6. Add direct ledger export routes and account-wide export integration.
7. Add web direct relationship list/detail/forms.
8. Add account overview integration points.
9. Add tests for authorization, pair uniqueness, balance math, exports, and non-appearance in group lists.

Rollback strategy: keep direct ledgers behind a feature flag until stable. Because group data would already have migrated to ledgers, rollback should disable direct routes rather than remove `Ledger`.

## Open Questions

- Should direct relationships have nicknames, or is pinning enough for first pass?
