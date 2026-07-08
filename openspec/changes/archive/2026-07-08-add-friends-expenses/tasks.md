## 1. Cleanup: Collapse AccountGroupPreference columns

> **Why this is first**: The preference cleanup is independent of the friend-ledger feature. It touches the DB schema, the API surface, and the web client — doing it first means the friend-ledger work can use the cleaned-up `preference: { starred, hidden }` shape from the start, rather than building on the 4-column shape and retrofitting later.
>
> **Design reference**: Decision 8 — drop `pinned` (dormant, never read or toggled), merge per-account `archived` into `hidden`, keep `starred` unchanged.

- [x] 1.1 Create a Prisma migration that: (a) runs `UPDATE account_group_preference SET hidden = hidden OR archived;` to merge the per-account `archived` data into `hidden`, (b) drops the `archived` column, (c) drops the `pinned` column. Verify the migration is reversible by backing up the table first.
- [x] 1.2 Update the `AccountGroupPreference` model in `packages/db/prisma/schema.prisma`: remove `starred`'s sibling `archived` and `pinned` columns. Keep `starred Boolean @default(false)` and `hidden Boolean @default(false)`. Update the inline comment to reflect the new 2-column shape.
- [x] 1.3 Run `bun prisma-generate` to regenerate the Prisma client with the new schema.
- [x] 1.4 Update `account.groups` procedure in `apps/api/src/trpc/routers/account/index.ts`: remove `pinned` from the `prefRecords` select, the `prefByGroupId` map, and the `defaultPref` object. The `preference` response shape changes from `{ starred, hidden, pinned }` to `{ starred, hidden }`. Remove the `archived`→`hidden` rename mapping (the column IS `hidden` now).
- [x] 1.5 Update `account.preferences` procedure: remove `pinned` from the response. The response becomes `{ starred, hidden }`.
- [x] 1.6 Update `account.setPreference` procedure: remove `pinned` from the Zod input schema. The input becomes `{ groupId, starred?, hidden? }`. Remove the `archived`→`hidden` mapping in the mutation body (write `hidden` directly to the `hidden` column).
- [x] 1.7 Update the web `AccountGroup` type in `apps/web/src/app/groups/group-buckets.ts` (which infers from `AppRouterOutput['account']['groups']`) — the `preference` type now infers automatically from the API change. Verify no web code references `preference.pinned` (grep for `pinned` in `apps/web/src/`).
- [x] 1.8 Run `bun check-types` and fix any type errors from the preference shape change.

## 2. Cleanup: Rename "contacts" to "friends"

> **Why this is separate from the feature**: The rename is a label/query-name change with no behavioral difference. Isolating it makes the diff reviewable and lets the feature work use the new `account.friends` name from the start.
>
> **Design reference**: Decision 9 — `account.contacts` becomes `account.friends`, "Contacts" tab becomes "Friends", all copy/types updated. Semantics unchanged (computed from shared group memberships).

- [x] 2.1 Rename the `contacts` procedure to `friends` in `apps/api/src/trpc/routers/account/index.ts`. Update the procedure name, the exported key, and any internal comments. The response shape is unchanged for now (friend-ledger metadata enrichment comes in task 5.3).
- [x] 2.2 Update all web code that calls `trpc.account.contacts` to call `trpc.account.friends` instead. Grep for `account.contacts` and `account\.contacts` in `apps/web/src/`.
- [x] 2.3 Rename the "Contacts" tab to "Friends" in the invite UI (`apps/web/src/app/groups/[groupId]/members/invite-contacts-tab.tsx` → rename file or update content). Update the tab label and any references.
- [x] 2.4 Add the "Friends" translation key to `en-US.json` via `bun i18n` CLI (never hand-edit). The old "Contacts" key can be removed or kept as an orphan (the `bun i18n check` will flag orphans — remove it to stay clean).
- [x] 2.5 Run `bun i18n check` to verify no orphan keys. Dispatch parallel subagents for other locales using the translate-strings skill if needed.
- [x] 2.6 Run `bun check-types` and `bun run test` to verify the rename doesn't break anything.

## 3. Schema: Add GroupType enum and Group.friendPairKey

> **Why this is the schema foundation**: All friend-ledger logic depends on the `groupType` discriminator and the `friendPairKey` uniqueness column. This must be in place before any API or web work.
>
> **Design reference**: Decision 1 (GroupType enum), Decision 2 (`friendPairKey` column on Group with partial unique index, smaller-id-first convention).

- [x] 3.1 Add `GroupType` enum to `packages/db/prisma/schema.prisma`: `enum GroupType { GROUP, FRIEND }`.
- [x] 3.2 Add `groupType GroupType @default(GROUP)` column to the `Group` model.
- [x] 3.3 Add `friendPairKey String?` column to the `Group` model with a comment documenting the format (`"accountAId:accountBId"` where `accountAId < accountBId`) and that it's null during the pending-invitation window. Create the partial unique index via raw SQL in the migration: `CREATE UNIQUE INDEX "Group_friendPairKey_key" ON "Group"("friendPairKey") WHERE "friendPairKey" IS NOT NULL AND "groupType" = 'FRIEND'`.
- [x] 3.4 Create the Prisma migration for these changes. The migration adds the enum, the `groupType` column with default `GROUP` (all existing groups backfill automatically), the `friendPairKey` column, and the partial unique index.
- [x] 3.5 Run `bun prisma-generate` to regenerate the Prisma client.

## 4. API: Friend ledger creation (friends.create procedure)

> **Why this is the core feature**: The `friends.create` procedure handles both the direct-accept path (peer is a known account) and the pending path (peer is unknown). Everything else builds on this.
>
> **Design reference**: Decision 3 (direct-accept: both ADMIN/ACTIVE immediately), Decision 4 (pending: auto-accept invitation, no user-facing Accept/Decline), Decision 5 (name = randomId()), Decision 13 (separate `friends` router + `lib/api/friends.ts`).

- [x] 4.1 Create `apps/api/src/lib/api/friends.ts` with a `createFriendLedger` function. It accepts: `callerAccountId`, `peer` (either `{ accountId }` for direct-accept, or `{ email, temporaryName? }` for pending email, or `{ link: true, temporaryName? }` for link), `currency`, `currencyCode`, and `information?`. It runs inside a `prisma.$transaction`.
- [x] 4.2 In `createFriendLedger`, implement the **direct-accept path**: when `peer.accountId` is known (either passed directly OR resolved from an email lookup via `Account.findUnique({ where: { email } })`), create the `Group` (type `FRIEND`, name `randomId()`), `Ledger`, two `GroupMember` rows (both ADMIN/ACTIVE), two `LedgerParticipant` rows, and set `friendPairKey` on the Group (with smaller-id-first convention). No `GroupInvitation`.
- [x] 4.3 In `createFriendLedger`, implement the **pending email path**: when the email does not resolve to an account, create the `Group` (type `FRIEND`, name `randomId()`), `Ledger`, one `GroupMember` (caller, ADMIN/ACTIVE), one `LedgerParticipant` (caller), and a `PENDING` `GroupInvitation` of type `EMAIL` with `role: ADMIN` and the optional `temporaryName`. Leave `friendPairKey` as `null` (set on auto-accept). The `friends.create` procedure does NOT send an invitation email — the peer will see the friend ledger automatically on next login via the auto-accept hook in Better Auth's `databaseHooks.user.create.after`.
- [x] 4.4 In `createFriendLedger`, implement the **link path**: same as pending email but the invitation is type `LINK`. Generate the token via the existing `createLinkInvitation` helper, return the `inviteUrl`.
- [x] 4.5 Implement **lookup-or-create** logic before creating: (a) direct-accept path — compute the `friendPairKey` and query for an existing FRIEND group with that key; if found, return its group with `existed: true`. (b) pending email path — query for an existing `FRIEND` group where the caller is ACTIVE and there's a PENDING invitation to the target email; if found, return it with `existed: true`. (c) link path — no pre-creation lookup (peer unknown).
- [x] 4.6 Create `apps/api/src/trpc/routers/friends/` directory with `index.ts` exporting a `friendsRouter` and `create.procedure.ts` with the `create` procedure. The procedure uses `protectedProcedure`, validates input with `friendFormSchema` (from domain, see task 4.7), resolves the caller from `ctx.auth.user`, calls `createFriendLedger`, and returns `{ groupId, existed }`.
- [x] 4.7 Create `friendFormSchema` in `packages/domain/src/schemas.ts`: a discriminated union or flexible object accepting `peerAccountId?`, `peerEmail?`, `temporaryName?`, `useLink?`, `currency` (required), `currencyCode?`, `information?`. Add superRefine validation to ensure exactly one peer selection mode is provided.
- [x] 4.8 Register the `friendsRouter` in `apps/api/src/trpc/routers/_app.ts`.
- [x] 4.9 Export the `friendsRouter` type from `apps/api/src/router.ts` (or wherever `AppRouter` is exported) so the web client can infer types.

## 5. API: Auto-accept for friend invitations

> **Why this is separate from creation**: The auto-accept hook runs at a different time (on signup or link-open) than creation. It's a system-triggered flow, not a user action.
>
> **Design reference**: Decision 4 — pending invitations are auto-accepted when the peer's account becomes available. On signup with matching email, or on link-open by an authenticated user.

- [x] 5.1 Implement the **auto-accept on signup** hook: in the Better Auth `databaseHooks.user.create.after` config (registered in `apps/api/src/lib/auth/index.ts`), query for all `PENDING` `EMAIL` invitations on `FRIEND`-typed groups targeting the new account's email. For each, auto-accept: create the `GroupMember` (ADMIN/ACTIVE), set `friendPairKey` on the Group, flip the invitation to `ACCEPTED`, reconcile the `LedgerParticipant`. Run each in its own transaction so one failure doesn't block the rest. The hook fires after the account row is committed to the database — no client-side dependency or race conditions.
- [x] 5.2 Implement the **auto-accept on link-open** in `groups.get`: when an authenticated account opens a link invite URL for a `FRIEND`-typed group with a valid PENDING token, the `getGroupProcedure` calls `acceptLinkInvitation` server-side before returning the payload. The user lands directly in the group as an active member — no Accept/Decline banner. A try-catch handles races (concurrent accept). Falls through to the regular banner flow if the group is not FRIEND or the token is no longer PENDING.
- [x] 5.3 Filter friend invitations out of `invitations.listForAccount`: add a `where` clause excluding invitations where `group.groupType = FRIEND`. This ensures the homepage Pending Invitations card never shows friend invitations.
- [x] 5.4 Handle the **race on auto-accept**: inside the auto-accept transaction, catch unique constraint violations on the `Group.friendPairKey` partial unique index. If the pair key is already set for this group (another concurrent auto-accept won), skip creating a second membership and instead join the existing group (upsert the `GroupMember`).

## 6. API: Restricted actions for FRIEND-typed groups

> **Why this is server-side enforcement**: The UI hides these actions, but the server must reject them as the hard guard. This prevents any client (including future API consumers) from breaking friend-ledger invariants.
>
> **Design reference**: Decision 6 — reject rename/delete/archive/leave/invite-more for FRIEND. Decision 7 — both members ADMIN.

- [x] 6.1 Add a `groupType` check to `groups.update` procedure (or `updateGroup` in `lib/api/groups.ts`): if `group.groupType === FRIEND`, reject `name` field changes with `TRPCError({ code: FORBIDDEN, message: 'friendLedgerNotRenamable' })`. Allow `information` and `currency`/`currencyCode` changes — these remain editable for friend ledgers (see grill-me answers #2, #6, #11).
- [x] 6.2 Add a `groupType` check to `groups.archive` procedure: if `group.groupType === FRIEND`, throw `TRPCError({ code: FORBIDDEN, message: 'friendLedgerNotArchivable' })`.
- [x] 6.3 Add a `groupType` check to `groups.delete` procedure: if `group.groupType === FRIEND`, throw `TRPCError({ code: FORBIDDEN, message: 'friendLedgerNotDeletable' })`.
- [x] 6.4 Add a `groupType` check to the leave-group procedure (`members.leave` or `groups.leave`): if `group.groupType === FRIEND`, throw `TRPCError({ code: FORBIDDEN, message: 'friendLedgerNotLeavable' })`.
- [x] 6.5 Add a `groupType` check to `invitations.create` and `invitations.createLink` procedures: if `group.groupType === FRIEND`, throw `TRPCError({ code: FORBIDDEN, message: 'friendLedgerFull' })`. (Friend ledgers are strictly 2 people — no additional invitations.)
- [x] 6.6 Add a `groupType` check to `invitations.revoke` procedure: if `group.groupType === FRIEND`, throw `TRPCError({ code: FORBIDDEN, message: 'friendLedgerNotRevocable' })`. This prevents a stuck ledger (one member, no re-invite path). The caller can hide the ledger instead. (See grill-me answer #1.)

## 7. API: Enrich account.groups with groupType and displayName

> **Why this is needed for the web**: The homepage and group cards need `groupType` to know which section to render a group in, and `displayName` to show the other member's name for friend ledgers.
>
> **Design reference**: Decision 5 — per-viewer `displayName` computed via `resolveParticipantDisplayName` for FRIEND, `Group.name` for GROUP. Decision 10 — homepage splits into Groups and Friends sections.

- [x] 7.1 Extend the `account.groups` procedure in `apps/api/src/trpc/routers/account/index.ts`: include `groupType` in the group select (it's a column on `Group`, so it comes through automatically — verify it's in the response).
- [x] 7.2 For each group returned by `account.groups`, compute `displayName`: if `groupType === GROUP`, set `displayName = group.name`. If `groupType === FRIEND`, find the OTHER member's display name by querying the group's members (excluding the caller's accountId) and applying `resolveParticipantDisplayName`. For pending invitations (where the peer hasn't joined yet), query the `GroupInvitation` for the peer's `temporaryName`/`email`.
- [x] 7.3 Enrich the `account.friends` query (renamed in task 2.1) with friend-ledger metadata: for each friend, check whether a FRIEND-typed group with a matching `friendPairKey` exists between the caller and that account, OR whether a pending `FRIEND` invitation exists targeting that account's email. Return this as a `hasFriendLedger` boolean on each friend entry.
- [x] 7.4 Update `invitations.previewLink` procedure to compute a FRIEND-aware display name: for `FRIEND`-typed groups where `Group.name` is a random ID (not displayable), return "Friend ledger with {inviter's Account.name}" (resolved via `invitedById`). For `GROUP`-typed groups, return `Group.name` unchanged.

## 8. Web: Friend ledger create route (/friends/create)

> **Why this is a new route**: The friend-create form is structurally different from the group-create form (peer picker instead of name field, no participants placeholder). A bespoke component is cleaner than a shared form with a toggle.
>
> **Design reference**: Decision 12 — `/friends/create` with peer picker (3 tabs: Friends/Email/Link), currency selector, optional info textarea, optional temporary name. Link path navigates to group page with dialog showing the link.

- [x] 8.1 Add `/friends/create` route to `apps/web/src/router.tsx` (and the corresponding route file under `apps/web/src/routes/friends/create.tsx` and `create.lazy.tsx`).
- [x] 8.2 Create the page component at `apps/web/src/app/friends/create/create-friend.tsx`. Use `react-hook-form` with `zodResolver` and the `friendFormSchema` from domain.
- [x] 8.3 Build the **peer picker** with three tabs (reusing the tab pattern from the existing `invite-card.tsx`): (a) Friends tab — dropdown of `account.friends` with "already has a friend ledger" indicator for friends where `hasFriendLedger` is true. (b) Email tab — email input + optional temporary name. (c) Link tab — just the currency selector and info field; the link is generated on submit.
- [x] 8.4 Add the `CurrencySelector` component (reuse from `apps/web/src/components/currency-selector.tsx`).
- [x] 8.5 Add an optional `Textarea` for the `information` field (friends might want to add context like "Flatmate expenses").
- [x] 8.6 On submit, call `trpc.friends.create.useMutation`. Handle the response: (a) direct-accept path — navigate to `/groups/$groupId/expenses`. (b) pending email path — navigate to `/groups/$groupId/members` with a toast. (c) link path — navigate to `/groups/$groupId` and open a `ResponsiveDialog` showing the invite URL. (d) if `existed === true` — navigate directly to the existing ledger, no toast. (See grill-me answer #13.)
- [x] 8.7 Add a "Create friend ledger" entry point on the homepage (next to or near the "Create a group" button in `SignedInHero`).

## 9. Web: Homepage restructure (separate Groups and Friends sections + CreateCard entry points)

> **Why this changes the homepage layout**: The user wants groups and friend ledgers in separate sections, not mixed into a single "Recent" list. "Recent" is dropped in favor of "Groups" (all active groups) and "Friends" (all friend ledgers, even if settled). Each section starts with a `CreateCard` action card linking to the create page — NOT section-level heading buttons.
>
> **Design reference**: Decision 10 — Starred (mixed) → Groups (all active groups) → Friends (all friend ledgers) → Archived (groups only) → Hidden (mixed). Decision 11 — `CreateCard` items as the first entry in each section list, replacing the initially-planned scope-picker dialog approach. Grill-me answer #7 — "no 'create expense' per group. the create expense is global for the entire group section."

- [x] 9.1 Update `partitionGroups` in `apps/web/src/app/groups/group-buckets.ts`: replace the single `active` array with separate `groups` and `friends` arrays. Partition by `groupType`: `GROUP`-type non-starred non-archived non-hidden → `groups`; `FRIEND`-type non-starred non-hidden → `friends`. Update the return type.
- [x] 9.2 Update `bucketFor` in the same file: `FRIEND`-type groups SHALL skip the `archived` bucket (defense-in-depth, even if `Group.archived` were somehow true).
- [x] 9.3 Update `RecentGroupList` in `apps/web/src/app/groups/recent-group-list.tsx`: replace the "Recent" section with five `CollapsibleSection`s — "Starred" (mixed, only if non-empty), "Groups" (with a `CreateCard` as the first item, always rendered), "Friends" (with a `CreateCard` as the first item, always rendered), "Archived" (groups-only, default closed, opacity-60, only if non-empty), "Hidden" (mixed, default closed, opacity-60, only if non-empty). Starred items are pulled out of Groups and Friends.
- [x] 9.4 Instead of section-level heading buttons, add a `CreateCard` component as the first item in the Groups section list. The card links to `/groups/create` with a `Plus` icon, title "Create a group", and description "Add friends and split expenses". A secondary action zone on the right links to `/groups/import` with a `Cloud` icon and "Import" label. The card matches `GroupCard`'s `min-h-[5.5rem]` for grid alignment.
- [x] 9.5 Add a `CreateCard` component as the first item in the Friends section list. The card links to `/friends/create` with a `Users` icon, title "Create a friend ledger", and description "Track 1-on-1 expenses with someone". No secondary action.
- [x] 9.6 Create the `CreateCard` component at `apps/web/src/app/groups/create-card.tsx`: a primary-tinted action card with primary gradient background, decorative blur element, optional icon/title/description slots, and an optional `secondaryAction` zone (e.g. for import). Also create the `ScopePickerDialog` component at `apps/web/src/app/groups/scope-picker-dialog.tsx` (using `ResponsiveDialog`, accepts `ScopePickerItem[]` with `displayName`/`meta`/`badge`/`onClick`) — it is built for future use but NOT wired into the homepage sections.
- [x] 9.7 Add the "Groups" and "Friends" translation keys to `en-US.json` via `bun i18n` CLI. Remove or repurpose the "recent" key. Also add `createGroupCard` and `createFriendLedgerCard` nested keys for the `CreateCard` title and description strings.
- [x] 9.8 Run `bun i18n check` to verify no orphan keys.

## 10. Web: Group card and detail page updates (FRIEND-aware UI)

> **Why this is per-card and per-page**: The card needs to render `displayName` (not `Group.name`) for friend ledgers, show the peer's avatar, show a pending indicator, and the detail page needs to hide the Members tab and disable the name field in Settings for FRIEND groups. The design principle is: reuse existing pages and UI elements, only hide/disable what doesn't apply — minimum new code.
>
> **Design reference**: Decision 5 (render `displayName`), Decision 6 (hide Members tab, disable name in Settings, keep currency/information editable). Grill-me answers #6 (drop Members tab, keep Settings with name disabled), #8 (show avatar with initials fallback), #9 (subtle pending indicator), #10 (reuse existing pages, only hide elements).

- [x] 10.1 Update `GroupCard` in `apps/web/src/app/groups/group-card.tsx`: render `group.displayName` instead of `group.name` as the card title. The `displayName` field comes from the updated `account.groups` response (task 7.2).
- [x] 10.2 Add an avatar to the left of the `displayName` for `FRIEND`-typed cards only. Use `Account.image` if set, fall back to initials (first letter of the peer's display name). GROUP cards show no avatar (unchanged). (See grill-me answer #8 — `Account.image` is not widely set today; initials are the primary fallback.)
- [x] 10.3 Add a subtle "Pending" badge to `FRIEND`-typed cards when the peer has a PENDING invitation (only one ACTIVE member). The badge should be consistent with the app's existing pending-state styling. (See grill-me answer #9.)
- [x] 10.4 Hide the archive action in the card dropdown menu for `FRIEND`-typed groups: conditionally render the `onToggleArchived` dropdown item only when `group.groupType === GROUP`.
- [x] 10.5 On the group detail page, hide the Members tab for `FRIEND`-typed groups. The tab navigation should skip Members when `groupType === FRIEND`. (See grill-me answer #6 — it's just 2 people, shown on the card already.)
- [x] 10.6 On the group Settings tab (`apps/web/src/app/groups/[groupId]/edit/`), for `FRIEND`-typed groups: hide or disable the name input field (read-only). Keep the currency selector and information textarea editable. (See grill-me answers #2, #6, #11 — currency and information remain editable; only name is locked.)
- [x] 10.7 On the group Settings tab, for `FRIEND`-typed groups: hide the delete group button and the leave group button (these actions are server-rejected, but the UI should not offer them).

## 11. Web: Link-path dialog on group page

> **Why this is on the group page, not the create page**: The user wants to see the ledger immediately after creating it via the link path, with the invite link surfaced as a dialog on the group page itself.
>
> **Design reference**: Decision 12 — link path navigates to `/groups/$groupId` immediately, invite link shown in a `ResponsiveDialog` on the group page.

- [x] 11.1 On the group page (`apps/web/src/app/groups/[groupId]/`), detect when the user arrived from a friend-ledger link-path creation (e.g. via a search param like `?linkInvite=...` or a router state flag). Open a `ResponsiveDialog` showing the invite URL with a copy button and `navigator.share` button.
- [x] 11.2 The dialog should explain that the link can be shared with the friend to let them join the ledger automatically.

## 12. Translations

> **Why this is last**: All new copy is defined by the feature work above. Translations must go through the `bun i18n` CLI — never hand-edit `apps/web/src/messages/*.json`.
>
> **AGENTS.md rule**: `en-US.json` is the source of truth; other locales fall back to it at runtime. Use the `bun i18n` CLI. Audit with `bun i18n check`.

- [x] 12.1 Add all new translation keys to `en-US.json` via `bun i18n` CLI: "Friends" (section heading, tab label), "Groups" (section heading), "Create friend ledger" (button), "Create expense" (card button), "Friend ledger already exists" (toast), "Invite link" (dialog title), "Share this link with your friend to add them to the ledger" (dialog description), and any other new copy.
- [x] 12.2 Remove orphaned keys: "Contacts" (renamed to "Friends"), "recent"/"Recent" (renamed to "Groups" for the homepage section). Run `bun i18n check` to identify orphans.
- [x] 12.3 Dispatch parallel subagents grouped by language family (Romance, Germanic+Nordic, Slavic, East Asian, Other) to translate the new keys into all non-English locales using the translate-strings skill. Each subagent confirms `bun i18n check --locale <own-locale>` exits 0.
- [x] 12.4 Run `bun i18n check` to verify all locales are in sync with `en-US`.

## 13. Tests

> **Why tests are last**: They verify the complete implementation. API integration tests hit the real DB; web tests verify the UI rendering.
>
> **AGENTS.md rule**: Never start the dev server for integration tests. API integration tests use `createCaller` (no server needed, only DB). Web integration tests need the API server on port 3001 — ask the user if it's not running.

- [x] 13.1 API integration test: `friends.create` direct-accept path with a contact — verify both members are ADMIN/ACTIVE, `friendPairKey` is set on the Group, no invitation exists, ledger appears for both accounts.
- [x] 13.2 API integration test: `friends.create` direct-accept path with an email that belongs to an existing account — verify the email is resolved to an accountId and the direct-accept path fires (no invitation).
- [x] 13.3 API integration test: `friends.create` pending email path — verify the group is created with only the caller, a PENDING EMAIL invitation exists with role ADMIN, `friendPairKey` is NOT set (null).
- [x] 13.4 API integration test: `friends.create` link path — verify the group is created with only the caller, a PENDING LINK invitation exists, the invite URL is returned.
- [x] 13.5 API integration test: lookup-or-create idempotency — creating a friend ledger with the same pair twice returns the same group with `existed: true` the second time.
- [x] 13.6 API integration test: auto-accept on signup — create a pending email friend invitation, then create a new account with the matching email, verify the invitation is auto-accepted and `friendPairKey` is set on the Group.
- [x] 13.7 API integration test: auto-accept on link-open — create a pending link friend invitation, then simulate an authenticated account opening the link, verify auto-accept.
- [x] 13.8 API integration test: friend invitations excluded from `invitations.listForAccount` — verify the query returns no friend invitations.
- [x] 13.9 API integration test: restricted actions — for a FRIEND group, verify: `groups.update` with `name` change is rejected (FORBIDDEN), `groups.update` with `information`/`currency` change is ALLOWED, `groups.archive` is rejected, `groups.delete` is rejected, `groups.leave` is rejected, `invitations.create` is rejected, `invitations.createLink` is rejected, `invitations.revoke` is rejected.
- [x] 13.10 API integration test: `account.groups` returns `groupType` and `displayName` — for a FRIEND group, verify `displayName` is the other member's name; for a GROUP group, verify `displayName` equals `Group.name`.
- [x] 13.11 API integration test: `account.friends` returns `hasFriendLedger` metadata — verify the flag is true when a matching `friendPairKey` group exists and false otherwise.
- [x] 13.12 API integration test: `invitations.previewLink` for a FRIEND-typed group returns "Friend ledger with {inviter name}" instead of the opaque Group.name.
- [x] 13.13 Migration test: verify per-account `archived` data is preserved in `hidden` after the column merge, and that dropping `pinned` loses no live data (all `pinned` values were `false`).
- [x] 13.14 Web test: homepage renders separate "Groups" and "Friends" sections — covered by `group-buckets.test.ts` (11 tests) and `RecentGroupList.test.tsx` (section rendering & CreateCard tests).
- [x] 13.15 Web test: `GroupCard` renders `displayName` for friend ledgers, shows the peer's avatar (initials fallback), and shows a "Pending" badge for pending friend ledgers — covered by `GroupCard.test.tsx` (8 tests).
- [x] 13.16 Web test: `/friends/create` form renders the three-tab peer picker, currency selector, and info field — covered by `CreateFriend.test.tsx` (4 tests). CreateCard navigation is covered by `RecentGroupList.test.tsx`.
- [x] 13.17 Web test: FRIEND-typed group detail page hides delete/leave buttons and passes `nameReadOnly` to GroupForm — covered by `EditGroup.test.tsx` (4 tests) and `GroupForm.test.tsx` (+2 tests).
- [x] 13.18 Web test: `CreateCard` items render with correct links, secondary action, and min-height; `ScopePickerDialog` renders correctly — covered by `CreateCard.test.tsx` (5 tests), `ScopePickerDialog.test.tsx` (4 tests), `group-buckets.test.ts` (11 tests), and `RecentGroupList.test.tsx`.
- [x] 13.19 Run `bun run test` (unit: 121 files, 1589 tests) and `bun test:integration` (API: 19 files, 143 tests; web: 3 files, 10 tests) — all pass.

- [x] 13.20 **Spec update**: Change `Group.name` for FRIEND groups from empty string to `randomId()` in spec docs (Decision 5 and all references). Implementation already uses `randomId()`. Test assertions updated to match.
- [x] 13.21 API integration test: `friendFormSchema` domain validation — test the `superRefine` exactly-one-mode invariant (reject 0 modes, reject 2+ modes, accept exactly 1 mode), email format validation, temporaryName trimming/limits, and required currency field. Add to `packages/domain/src/schemas.test.ts`.
- [x] 13.22 API integration test: self-ledger rejection — verify `friends.create` throws `BAD_REQUEST` when `peerAccountId === callerAccountId` and when `peerEmail` resolves to the caller's own account ID.
- [x] 13.23 API integration test: expense CRUD on a FRIEND-typed group — create a FRIEND group, then create, list, get, update, and delete an expense within it. Verify expense operations work identically to GROUP-typed groups.
- [x] 13.24 API integration test: balance calculation on a FRIEND-typed group — create a FRIEND group, add an expense where peer A pays and peer B owes, then verify `groups.balances.get` returns correct balances and reimbursement suggestions.
- [x] 13.25 API integration test: cross-direction lookup-or-create — create a friend ledger with a pending email invitation from Account A to Account B's email. Then simulate Account B creating a friend ledger targeting Account A by accountId. Verify the system returns the existing group with `existed: true` (no duplicate).
- [x] 13.26 API integration test: `friendPairKey` race safety — verify that the `P2002` catch in `autoAcceptPendingFriendInvitationsForAccount` gracefully handles the case where the pair key is already set by a concurrent auto-accept.
- [x] 13.27 API integration test: `displayName` fallback priority — verify the `account.groups` response uses the priority chain correctly: peer account name → invitation temporaryName → invitation email. Test all three fallback levels.
- [x] 13.28 Web test: `CreateFriend` interaction tests — test form submission for each tab (Friends, Email, Link), navigation after creation for direct-accept/pending/link/existed paths, error handling, and the empty friends list state ("No friends yet").
- [x] 13.29 Web test: `GroupForm` fields editable with `nameReadOnly` — verify that the currency selector and information textarea remain editable when `nameReadOnly` is true.
- [x] 13.30 Web test: `EditGroup` GROUP-type control — verify that for a GROUP-typed group, archive/delete sections ARE rendered and `nameReadOnly` IS false (the opposite of the FRIEND assertions).
- [x] 13.31 Web test: `GroupTabs` Members tab hidden for FRIEND — verify the Members tab is not rendered when group type is FRIEND.
- [x] 13.32 API integration test: `displayName` resolves peer name specifically (not just truthy) — verify `displayName` equals the other member's `Account.name` (e.g. 'Test Peer') for a direct-accept FRIEND group, rather than only checking it's non-empty.
