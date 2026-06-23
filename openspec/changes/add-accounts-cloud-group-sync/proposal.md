## Why

Spliit currently treats local/browser state and anonymous group participants as first-class product primitives, which makes account ownership, multi-device use, and reliable cloud group access hard to reason about. This change establishes authenticated accounts and online group state as the source of truth for a fresh account-backed application.

## What Changes

- **BREAKING** Introduce authenticated accounts as required users for cloud groups and expenses.
- **BREAKING** Replace anonymous group participants with account-backed group members for new native cloud groups.
- **BREAKING** Treat the server database as the source of truth for groups, members, expenses, balances, activities, documents, and settings.
- Add authentication using magic link, Google OAuth, and email plus password. Username-only password login is out of scope.
- Add account profiles with stable IDs, display names, email identity, auth provider metadata, and account lifecycle state.
- Add group membership roles and invitations so groups can be created, joined, and managed by accounts.
- Introduce `Ledger` as the shared accounting core for groups and future direct account relationships.
- Replace browser-local group discovery and active participant selection with server-backed account membership state.
- Remove local-only active participant selection for cloud groups; the active user is the signed-in account.
- Allow legacy schemas and data contracts to be changed freely because this roadmap is treated as greenfield for the new account-backed product.

## Capabilities

### New Capabilities

- `account-authentication`: Sign up, sign in, sign out, session handling, and supported auth providers.
- `account-profiles`: Account identity, profile display data, provider linkage, and account lifecycle.
- `group-membership`: Account-backed group membership, roles, invitations, and member removal rules.
- `ledger-accounting`: Ledger, ledger participant, expense, balance, activity, export, recurrence, document, and currency semantics shared by groups and direct relationships.
- `cloud-group-sync`: Online source-of-truth semantics for account-backed groups across sessions and devices.

### Modified Capabilities

- `groups`: Groups change from anonymous/share-link entities with local recents into account-owned or account-member cloud resources.
- `expenses`: Expense payer and split participants change from group-local anonymous participants to account-backed group members for native cloud groups.
- `activities`: Activity actors change from optional participant IDs to account-backed membership actors.
- `exports`: Export authorization changes from possession of a group ID to membership-based access.
- `uploads`: Document upload authorization changes from open presign access to account and membership checks.

## Impact

- Database: major Prisma schema redesign around `Account`, auth identities, sessions, memberships, invitations, and account-backed expense relations.
- API: authenticated tRPC context, protected routers, membership authorization, and migration/removal of anonymous access assumptions.
- Web: sign-in flows, account session state, member-aware group UI, and replacement of recent/active group localStorage behavior.
- Domain: schemas and balance/totals types need to work with account-backed member identifiers while preserving integer cents and basis-point split semantics.
- Operations: auth secrets, email delivery for magic links, OAuth credentials, session storage, and production-safe account lifecycle controls.
- Roadmap dependency: direct account expenses, homepage overview, and Spliit import should build on this account and membership model.
