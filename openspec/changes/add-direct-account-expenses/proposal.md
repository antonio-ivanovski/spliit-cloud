## Why

Some expenses are naturally between two accounts and should not require users to create or navigate a visible group. This change adds a direct account-to-account expense experience backed by a ledger abstraction that is visible as a direct relationship, not as a group.

## What Changes

- Add direct expenses between authenticated accounts without requiring the user to create a named group.
- Support feature parity with group expenses where the feature applies to two accounts: integer cents, payer/payee members, split modes, reimbursements, notes, dates, categories, recurrence, and documents.
- Add direct account balances so each account can see what they owe or are owed by another account.
- Add direct expense creation, editing, deletion, and settlement flows scoped to the two involved accounts.
- Implement direct expenses as visible two-account ledgers, not hidden groups, and do not allow adding third parties to a direct ledger.
- Ensure direct expenses participate in account-level search, homepage overview, direct exports, account-wide exports, and notifications/activity once those capabilities exist.
- Require both sides to be authenticated accounts; no unauthenticated counterparty is allowed in the account-backed product.

## Capabilities

### New Capabilities

- `direct-expenses`: Account-to-account expense creation, editing, deletion, settlement, and detail views.
- `direct-balances`: Aggregated balances between two authenticated accounts.

### Modified Capabilities

- `expenses`: Expense APIs and domain types must distinguish or generalize group-scoped and direct account-scoped expenses.
- `balances`: Balance calculations must support direct account ledgers in addition to group balances.
- `account-profiles`: Account lookup or invitation flows must support selecting a direct expense counterparty.

## Impact

- Database: new `Ledger` and direct account relation tables that support direct two-account relationships without creating visible or hidden groups.
- API: new account-scoped procedures for direct expenses and balances, with authorization based on account participation.
- Web: direct expense list/detail/forms, counterparty selection, and settlement UI outside the group routes.
- Domain: shared expense and balance math should avoid duplicating group-only assumptions.
- Product architecture: this proposal depends on `add-accounts-cloud-group-sync` for authenticated accounts and stable account identity.
