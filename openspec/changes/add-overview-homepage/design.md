## Context

The current `apps/web/src/app/page.tsx` is a signed-out style landing page with links to groups and GitHub. Group discovery is currently handled through browser-local recent/starred/archived group state in `apps/web/src/app/groups/recent-groups-helpers.ts`.

After accounts and cloud group sync, the homepage should become the signed-in user's operational dashboard. It must aggregate server-authoritative data across memberships, recent activity, expenses, balances, and direct ledgers when available.

## Goals / Non-Goals

**Goals:**

- Make `/` useful for authenticated users by summarizing their current expense state.
- Show cloud groups from membership data, not browser-local recents.
- Show direct account relationships once `add-direct-account-expenses` exists.
- Show aggregate owed/owing totals, recent expenses, recent activity, and quick actions.
- Handle loading, empty, error, and signed-out states.
- Keep overview queries bounded and performant.

**Non-Goals:**

- Replacing full group detail pages or direct ledger detail pages.
- Building complex analytics or budgeting features.
- Showing every historical expense on the homepage.
- Implementing direct expenses or auth foundation inside this change.

## Decisions

### 1. Keep signed-out landing, replace signed-in first screen

`HomePage` should branch on session state:

- Signed out: show sign-in entry and concise product positioning.
- Signed in: show account overview dashboard.
- Session loading: show dashboard skeleton.

Rationale: the root route is still the best entry point, but authenticated users should not land on marketing content.

Alternatives considered:

- Move dashboard to `/dashboard`: clean separation, but creates an extra redirect and leaves `/` less useful.
- Remove landing entirely: weak for unauthenticated users and invite/import entry links.

### 2. Add an account overview API rather than composing many client queries

Create an account-scoped endpoint such as `trpc.overview.get` that returns a bounded dashboard payload:

- Account profile summary.
- Group summaries: id, name, role/status, member count, default currency, and unread/recent activity metadata.
- Direct summaries when direct ledgers exist: counterparty, net balance, recent expense metadata.
- Imported participant entries that later link to the current account must contribute their historical balances after linkage.
- Aggregate balances: total owed by current account, total owed to current account, unsettled relationship/group count.
- Recent expenses across accessible ledgers, limited by count.
- Recent activity across accessible ledgers, limited by count.
- Import/action suggestions if applicable.

Rationale: the dashboard needs cross-resource aggregation. Doing this as many independent client queries increases loading complexity and can create inconsistent snapshots.

Alternatives considered:

- Client-compose groups, expenses, balances, and activities queries: simpler API work, worse performance and inconsistent states.
- Materialize everything into dashboard tables immediately: faster reads, but premature unless query cost proves too high.

### 3. Use server-authoritative data only

Overview data comes from the API and reflects server-authoritative account, group, expense, balance, and activity state.

Rationale: this keeps the first dashboard simple and consistent with the current account/cloud group scope.

Alternatives considered:

- Client-compose browser-local group data with server data: conflicts with server-backed account state.

### 4. Aggregate by ledger for future compatibility

Overview aggregation should use ledger-level primitives when available:

- Group ledgers contribute group summaries and group balances.
- Direct ledgers contribute direct relationship summaries and direct balances.

The UI can still show "Groups" and "People" sections, but API internals should avoid hardcoding only group expense sources.

Rationale: this avoids redesigning overview after direct expenses ship.

Alternatives considered:

- Build overview only for groups first: acceptable as a phased UI, but API contracts should leave room for direct ledgers.

### 5. Keep dashboard data bounded

Use fixed limits and cursor-based expansion for heavy sections:

- Recent expenses: default 10.
- Recent activity: default 10.
- Groups: include active groups first, optionally paginate if group count is high.
- Direct relationships: include unsettled/recent first, paginate later.
- Pinned groups and pinned direct relationships should be prioritized.

Aggregate totals should be computed from indexed summary queries or ledger balance helpers, not by sending all historical expenses to the client.

Rationale: a homepage should load quickly even for long-lived accounts.

Alternatives considered:

- Fetch all expenses and calculate in browser: simple but scales poorly.
- Only show static group links: misses the requested overview value.

### 6. Define per-account list preferences on the server

Starred, archived, pinned, or hidden group state should become account-scoped server data, for example `AccountGroupPreference`. Direct relationships should support pinning but not archiving. Existing localStorage starred/archived state may be discarded because this is a fresh account-backed app.

Group archive is per account and only affects that account's overview/list presentation. A user cannot archive a group while their balance in that group is unsettled. The archive flow may offer a force option that creates a normal reimbursement expense with an appropriate archival title/note to bring that account's group balance to zero before archiving. Archiving a group must not archive it for other members or remove membership.

Rationale: account overview must be consistent across devices.

Alternatives considered:

- Keep starred/archived in localStorage: conflicts with cloud account behavior.
- Put preference flags on `GroupMember`: possible, but preferences can expand and may be cleaner as a separate table.
- Archive direct relationships: rejected because direct account balances should remain operationally visible and are not group projects.

### 7. Homepage quick actions are account-aware

Primary dashboard actions:

- Create group.
- Create direct expense, if feature exists.
- Import Spliit group.
- Invite/join pending group.

Actions should route to the relevant feature and preserve return navigation to the dashboard.

Rationale: the dashboard is the hub after sign-in.

Alternatives considered:

- Keep actions only inside feature pages: adds friction for common workflows.

## Risks / Trade-offs

- [Risk] Dashboard query becomes a large, hard-to-maintain endpoint. -> Mitigate with internal service functions per data slice and a typed response schema.
- [Risk] Aggregate totals can be expensive. -> Mitigate with bounded recent data, indexed balance queries, and later materialized summaries only if needed.
- [Risk] Direct expenses may not exist when dashboard ships. -> Mitigate by designing optional direct sections behind feature flags and nullable response fields.
- [Risk] Replacing marketing homepage hurts signed-out onboarding. -> Mitigate by preserving signed-out landing/sign-in state.

## Migration Plan

1. Complete account/session detection from `add-accounts-cloud-group-sync`.
2. Add an `overview` tRPC router and protected `get` procedure.
3. Implement group summaries from membership-backed groups.
4. Implement aggregate group balances using existing domain balance helpers or ledger helpers.
5. Replace local recent/starred/archived helpers with server-backed preferences where needed.
6. Redesign `apps/web/src/app/page.tsx` to branch signed-out/signed-in and render dashboard sections.
7. Add direct ledger sections after `add-direct-account-expenses`.
8. Add Playwright coverage for signed-out, empty signed-in, and populated signed-in states.

Rollback strategy: keep the signed-in dashboard behind a feature flag or route-level branch until stable. If disabled, fall back to the current landing page and groups route.

## Open Questions

- Should homepage be the default post-login redirect, or should invite/import flows continue to their original target after auth?
- Which totals matter most: net balance, total owed, total owing, recent spending, or all four?
- Should settled direct relationships appear on the homepage or only unsettled/recent ones?
- Should account-level search live on the homepage now or be a later global command/search feature?
