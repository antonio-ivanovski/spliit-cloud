## Why

The current homepage is a marketing-style entry point and the groups page relies on locally remembered groups. After accounts and cloud group sync, signed-in users need the first screen to summarize their real financial state across groups and direct account relationships.

## What Changes

- Replace the signed-in homepage with an account overview of expenses, balances, groups, and direct account relationships.
- Show recent activity and recent expenses across all groups and direct ledgers the account can access.
- Show aggregate totals such as total owed, total owed to the user, recent spending, and unsettled balances.
- Show cloud groups from membership data instead of browser-local recent groups.
- Include entry points for creating a group, creating a direct expense, and importing an existing Spliit group.
- Keep a signed-out landing/sign-in entry state, but make the authenticated homepage a functional dashboard.
- Support loading, empty, and error states.

## Capabilities

### New Capabilities

- `account-overview`: Authenticated dashboard aggregating groups, direct expenses, balances, and activity.

### Modified Capabilities

- `groups`: Group list presentation changes from local recent groups to membership-backed cloud groups.
- `cloud-group-sync`: Membership-backed group state surfaces on the overview.
- `direct-expenses`: Direct expense summaries appear in the account overview once direct expenses exist.

## Impact

- API: account-level overview queries that aggregate group memberships, expenses, balances, activity, and direct ledgers efficiently.
- Web: homepage route redesign, signed-in/signed-out branching, dashboard UI, and removal or demotion of local recent group helpers.
- Domain: aggregate summary helpers may be needed for cross-group and direct-ledger totals.
- Performance: overview queries need pagination or bounded recent data to avoid expensive all-account scans.
- Roadmap dependency: depends on `add-accounts-cloud-group-sync`; direct-expense widgets can ship after or behind `add-direct-account-expenses`.
