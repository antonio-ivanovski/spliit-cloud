## Context

Spliit groups are multi-person expense ledgers backed by `Group` + `Ledger` + `GroupMember` + `LedgerParticipant`. A previous attempt at "direct account-to-account expenses" introduced a parallel ledger/group/type system and proved too complex. This change instead piggy-backs on the existing group machinery: a friend expense ledger is a `Group` with a `FRIEND` type discriminator and a few server-enforced constraints. All existing expense, split, balance, invitation, and activity code is reused unchanged.

Two related cleanups ride along:

- The `AccountGroupPreference` model has four boolean columns today (`starred`, `archived`, `pinned`, `hidden`), but only `starred` and the per-account `archived` (exposed on the API as `hidden`) are live. `pinned` is dormant (selected by the API but never read or toggled), and the DB has both an `archived` column and a `hidden` column for the same concept. This change drops `pinned` and merges the per-account `archived` into `hidden`, keeping `starred` as the "favorited" concept with no rename.
- The "contacts" concept (the `account.contacts` query and the "Contacts" invite tab) is renamed to "friends" for vocabulary consistency with the new friend-ledger feature.

## Goals / Non-Goals

**Goals:**

- Let a user create a 1-on-1 expense ledger with one other person, reusing the full group machinery.
- Enforce at most one friend ledger per unordered account pair (lookup-or-create via `friendPairKey` on Group).
- For any peer that can be resolved to a known `accountId` — whether picked from the friends list OR entered by email that belongs to an existing `Account` — create the ledger with both members as ACTIVE `ADMIN` immediately, no invitation step.
- For peers that cannot be resolved to an `accountId` (email without an account, or link invite), create a pending invitation that is **auto-accepted** (no user-facing accept/deny) when the peer's account becomes available.
- Show the friend ledger on each viewer's home screen with the OTHER member's display name as the card title.
- Server-enforce a restricted action set for friend ledgers (no rename, delete, archive, leave, or additional invitations).
- Collapse `AccountGroupPreference` to two live columns (`starred`, `hidden`).
- Rename "contacts" → "friends" throughout.
- Split the homepage into separate "Groups" and "Friends" sections (drop "Recent"); keep "Starred" mixed; keep "Archived" groups-only; keep "Hidden" mixed.
- Add section-level "Create expense" buttons (one for the Groups section, one for the Friends section) that open a scope-picker dialog; keep direct navigation when scope is already known.

**Non-Goals:**

- Rebuilding the ledger or expense data model. Friend ledgers use the exact same `Ledger`, `Expense`, `LedgerParticipant` tables.
- Building a parallel UI for friend ledgers. They render through the existing group pages with type-based branching.
- Adding a "settle up" or payment flow. Friend ledgers are expense ledgers, not payment instruments.
- Migrating or renaming the `starred` concept. `starred` stays as-is.
- Touching the group-level `Group.archived` flag or its ADMIN-only archive flow.

## Decisions

### 1. Discriminate friend ledgers with `GroupType`, not a parallel table

Add `enum GroupType { GROUP, FRIEND }` and `Group.groupType GroupType @default(GROUP)`. Existing groups backfill to `GROUP`. Every code path that needs to branch on "is this a friend ledger?" checks `group.groupType`.

Rationale: a friend ledger is structurally identical to a group (same `Ledger`, `GroupMember`, `LedgerParticipant`, `Expense` relations). The only differences are behavioral constraints and display-name derivation. A type discriminator is the minimal schema change.

Alternatives considered:

- Separate `FriendLedger` table: duplicates all relations, doubles maintenance, and forces a parallel expense pipeline. Rejected — this was the failed approach.
- Use `Group.name` as the discriminator (e.g. prefix `__FRIEND__`): fragile, leaks intent into a user-facing field, no DB-level guarantee.

### 2. Per-pair uniqueness via a `friendPairKey` on Group

Add a nullable `friendPairKey` column on `Group` with a partial unique index:

```prisma
model Group {
  // ... existing fields ...
  // Unordered account pair key, e.g. "abc123:def456" where abc123 < def456.
  // Null during the pending-invitation window (peer hasn't joined yet),
  // populated when both members join (direct-accept or auto-accept).
  friendPairKey String?
}
```

The uniqueness constraint is a partial unique index (raw SQL in the migration since Prisma doesn't support partial unique indexes):

```sql
CREATE UNIQUE INDEX "Group_friendPairKey_key"
  ON "Group"("friendPairKey")
  WHERE "friendPairKey" IS NOT NULL AND "groupType" = 'FRIEND';
```

The `friendPairKey` format is `"accountAId:accountBId"` where `accountAId` is always the lexicographically smaller of the two — a `friendPairKey(a, b)` helper returns `a < b ? \`${a}:${b}\` : \`${b}:${a}\``.

During the pending-invitation window (email without account, or link not yet opened), `friendPairKey` is `null` — the group exists with the caller as the only member. When the peer joins (auto-accept), `friendPairKey` is populated inside the join transaction.

Lookup-or-create logic in `friends.create`:

1. **Contact path (peer accountId known):** compute `friendPairKey(callerId, peerId)`. Query `Group.findFirst({ where: { friendPairKey, groupType: 'FRIEND' } })`. If found, return its id. Otherwise create.
2. **Email-with-existing-account path:** lookup `Account` by email. If found, treat as contact path (above).
3. **Email-without-account path:** before creating, check for an existing `FRIEND` group where the caller is an ACTIVE member AND there is a PENDING invitation to the target email. If found, return it. Otherwise create with `friendPairKey = null`.
4. **Link path:** the peer is unknown at create time, so there's no pre-creation lookup. If the caller later tries to create another friend ledger via any path that resolves to the same account, the lookups above will find the existing one.

Race safety: the partial unique index on `Group.friendPairKey` is the hard guard. If two concurrent creates for the same pair slip past the soft lookup, the second `group.update` that sets `friendPairKey` fails with a unique violation and the caller returns the existing group. For the email/link path, the guard fires when the peer joins and `friendPairKey` is set; the join transaction catches the unique violation and, if the key is already set, joins the existing group instead.

#### Why `friendPairKey` over a `FriendLink` junction table

A separate `FriendLink` junction table was considered but adds unnecessary complexity for a simple 1-on-1 invariant. The pair key is a single string column on `Group`, the partial unique index provides the same DB-level uniqueness guarantee, and the lookup is equally indexed. No extra table, no extra Account relations (`friendLinksAsA`/`friendLinksAsB`), no FK cascade propagation to manage — just one nullable column on the existing `Group` model.

Alternatives considered:

- **`FriendLink` junction table:** an earlier version of this design chose this approach for normalization and natural `Account` relations. Rejected in favor of `friendPairKey` for simplicity — one fewer table, one fewer entity to reason about.
- **Uniqueness on `GroupMember` pairs:** cannot express "two rows in the same group form a unique pair" as a single DB constraint.
- **Application-level-only check (no DB constraint):** race conditions silently create duplicates.

### 3. Direct-accept path: both members ACTIVE + ADMIN immediately, no invitation

When the peer can be resolved to a known `accountId` — either by picking from the friends list OR by entering an email that belongs to an existing `Account` — `friends.create` creates the `Group` (type `FRIEND`), the `Ledger`, TWO `GroupMember` rows (both `ADMIN`/`ACTIVE`), a `LedgerParticipant` for each, and sets `friendPairKey` on the Group. No `GroupInvitation` is created. The ledger appears on the peer's home screen on their next load.

The email lookup is a server-side `Account.findUnique({ where: { email } })` inside `friends.create`. If the email resolves to an account, the direct-accept path fires regardless of whether the caller picked from the friends list or typed the email manually. This means the caller can start a friend ledger with anyone who has a Spliit account, not just people they've previously shared groups with.

Rationale: the user wants friend ledgers to be "accepted by default" — no accept step, no decline option. Any peer that can be addressed by `accountId` is added immediately. Both-admin matches the "neither side is less than the other" requirement.

Alternatives considered:

- Always go through invitations (even for known accounts): adds an accept step the user explicitly rejected.
- Only allow direct-accept for the friends list, force invitations for typed emails: arbitrarily limits the user; if the email has an account, there's no reason to invite instead of add.
- Make the caller ADMIN and the peer MEMBER: asymmetry is wrong for a 2-person ledger.

### 4. Pending path: email-without-account and link — auto-accept, no user-facing accept/deny

When the peer cannot be resolved to a known `accountId` (the email has no Spliit account, or a link invite is generated for someone whose identity is unknown), `friends.create` creates the `Group` (type `FRIEND`), the `Ledger`, ONE `GroupMember` (the caller, `ADMIN`/`ACTIVE`), and a `GroupInvitation` with `role: ADMIN`. `Group.friendPairKey` is `null` at this point — the pair key is set when the peer joins.

The invitation is **auto-accepted**, not user-accepted. There is no Accept or Decline button for friend invitations. The peer is added automatically when their account becomes available:

- **Email without account:** when someone signs up with the invitation's email, the system auto-accepts the invitation (creates the second `GroupMember` as `ADMIN`/`ACTIVE`, sets the `friendPairKey` on the Group, flips the invitation to `ACCEPTED`). This happens as a post-signup hook, not a user action.
- **Link invite:** when someone opens the link and is signed in (or signs in/up), the system auto-accepts — no preview-with-accept-decline UI. The peer is added immediately as the second `ADMIN`/`ACTIVE` member, the `friendPairKey` is set on the Group, and the invitation is flipped to `ACCEPTED`.

Friend invitations do NOT appear in the `PendingInvitations` card on the homepage (the `invitations.listForAccount` query filters out invitations on `FRIEND`-type groups). The peer sees the friend ledger appear on their home screen directly — no accept step, no notification card.

The existing `GroupInvitation` infrastructure is reused under the hood (email matching, link tokens, `temporaryName`, pre-materialized `LedgerParticipant`) — only the accept/deny UX is bypassed. The `temporaryName` serves as the display name until the peer signs up.

Rationale: the user explicitly stated "direct friends expenses are not invitation accept/deny, they are being accepted by default." Reusing the invitation infrastructure (rather than building a parallel "pending friend" mechanism) avoids new tables and new code paths; only the acceptance trigger changes from "user clicks Accept" to "system auto-accepts on account availability."

Alternatives considered:

- Require explicit accept/decline for friend invitations: the user explicitly rejected this.
- Build a separate "pending friend" mechanism instead of reusing `GroupInvitation`: duplicates working infrastructure (email matching, link tokens, `LedgerParticipant` pre-materialization) for no benefit.
- Disallow email/link for friends entirely (direct-accept only): loses the "I just met this person" use case where the peer doesn't have a Spliit account yet.

### 5. Server-derived `Group.name` (empty string), per-viewer `displayName`

The `Group.name` column is `NOT NULL` in the schema. For `FRIEND` groups, `friends.create` sets `name` to an empty string `""` — the simplest possible value. The name is never shown to users; the `account.groups` procedure computes a per-viewer `displayName` field for each returned group:

- For `FRIEND` groups: find the OTHER member's display name using the existing `resolveParticipantDisplayName` priority chain: `Account.name` (if the peer is an active member) → `Invitation.temporaryName` (if pending) → `Invitation.email` (if pending and no temp name).
- For `GROUP` groups: `displayName = group.name` (unchanged).

The web `GroupCard` renders `displayName` for both types.

The public `invitations.previewLink` procedure (used when an unauthenticated person opens a link invite URL) also needs a FRIEND-aware display name. For `FRIEND` groups, `Group.name` is `""`, so the preview SHALL show "Friend ledger with {inviter name}" instead of `Group.name`. The inviter's name is resolved from the inviter's `Account.name` (via `invitedById`), with the invitation's `temporaryName` as a fallback label for the ledger itself.

Rationale: the user wants the simplest approach. `Group.name` is `NOT NULL` so a value is required, but an empty string satisfies the constraint. The `groupFormSchema`'s `.min(2)` validation only applies to the group-create form, not to the friend-create path (which uses a separate `friendFormSchema` and `createFriendLedger` function). Since all API responses for `FRIEND` groups include the computed `displayName`, no code path reads `Group.name` directly for display. The `previewLink` procedure is the one public endpoint that currently reads `Group.name` directly — it must be updated to compute a FRIEND-aware display name.

Alternatives considered:

- Opaque structured string (e.g. `FRIEND::{accountIdA}::{accountIdB}`): more information in the DB but meaningless to humans and never read by code. Empty string is simpler.
- Random string (e.g. a UUID): also works but adds noise in raw DB queries for no benefit.
- Allow a user-set name: the user explicitly rejected this ("shall not have a direct name").

### 6. Restricted actions for `FRIEND` groups, enforced server-side

Every group mutation procedure checks `groupType` and rejects the following for `FRIEND`:

| Action | Procedure | Rejection reason |
|---|---|---|
| Rename (change `name`) | `groups.update` (name field only) | `friendLedgerNotRenamable` |
| Archive / unarchive | `groups.archive` | `friendLedgerNotArchivable` |
| Delete group | `groups.delete` | `friendLedgerNotDeletable` |
| Leave group | `groups.leave` (or `members.leave`) | `friendLedgerNotLeavable` |
| Create additional invitations | `invitations.create`, `invitations.createLink` | `friendLedgerFull` |
| Revoke pending invitation | `invitations.revoke` | `friendLedgerNotRevocable` |

Allowed for `FRIEND` (unchanged or explicitly carved out): star/unstar, hide/unhide, create/edit/delete expenses, view activity, **edit `information`** (friends may want to update context notes), **change `currency`** (same settings flow as regular groups — mistakes at creation should be fixable). The `groups.update` procedure for `FRIEND` accepts `information` and `currency`/`currencyCode` changes but SHALL reject `name` changes.

The web UI reuses the existing group pages with type-based hiding:
- **Settings tab**: shown for `FRIEND` groups. The name input is hidden or disabled (read-only). The currency selector and information textarea remain editable.
- **Members tab**: hidden for `FRIEND` groups (it's just 2 people, shown on the card already; no invite card needed).
- **Expenses, Balances, Activity tabs**: shown unchanged.

The server rejection is the hard guard for the blocked actions above.

Rationale: the user wants friend ledgers to be lightweight and invariant — once created between two people, they stay. Leaving would break the "one ledger per pair" invariant. Archiving is not a friend concept. Renaming is meaningless (the name is derived). But currency and information are practical settings that should remain editable — a wrong currency at creation should be fixable, and friends may want to update context notes over time. Revoking a pending invitation would leave the ledger in a stuck state (one member, no way to re-invite since `invitations.create` is also blocked), so revoke is blocked too — the caller can hide the ledger instead, and pending email invitations simply sit until the peer signs up or expires.

Alternatives considered:

- Block all of `groups.update` (including currency and information): too restrictive — wrong currency is unfixable, and the user explicitly wants information to be editable.
- Allow revoking pending invitations: creates a stuck ledger (one member, no re-invite path, no delete, no leave). Blocking revoke is safer.
- Allow leaving a friend ledger: breaks the per-pair uniqueness invariant (what happens when they re-friend?).
- Allow archiving a friend ledger: introduces a concept the user said doesn't apply.

### 7. Both members ADMIN; role is mostly cosmetic for `FRIEND`

Both `GroupMember` rows in a `FRIEND` group are `ADMIN`. This is set at create time (contact path) or at accept time (email/link path, via the invitation's `role`). Most ADMIN-only actions are disabled for `FRIEND` anyway, so the role is primarily about symmetry — neither side is "less than" the other.

Rationale: the user explicitly requested both-admin. It also avoids edge cases where one member can't perform an action the other can.

### 8. Collapse `AccountGroupPreference`: drop `pinned`, merge `archived`→`hidden`, keep `starred`

Migration (single transaction):

1. `UPDATE account_group_preference SET hidden = hidden OR archived;`
2. `ALTER TABLE account_group_preference DROP COLUMN archived;`
3. `ALTER TABLE account_group_preference DROP COLUMN pinned;`

The API surface changes:

- `account.groups` returns `preference: { starred, hidden }` (was `{ starred, hidden, pinned }`).
- `account.preferences` returns `{ starred, hidden }`.
- `account.setPreference` accepts `{ groupId, starred?, hidden? }` (drops `pinned`).

The `starred` column and the "Starred" homepage section are unchanged — no rename, no behavior change.

Rationale: `pinned` is dormant (never read, never toggled). The per-account `archived` column and the `hidden` column encode the same concept; keeping both is confusing. `starred` is live and works; touching it would expand the blast radius for no benefit.

Alternatives considered:

- Merge `starred`→`pinned` and rename the UI section: the user initially considered this, then reversed to minimize touched areas.
- Keep all four columns: leaves dead schema and a confusing API surface.

### 9. Rename "contacts" → "friends" throughout

The `account.contacts` query becomes `account.friends`. The "Contacts" tab in the invite UI becomes "Friends". All related TypeScript types, variable names, and translation keys are updated. The semantics are unchanged — the list is still computed on the fly from shared group memberships.

Rationale: with the new "friend expense ledger" feature, having two different words ("contacts" for people-you-know and "p2p" for the ledger) is confusing. "Friends" covers both: "your friends" (the contact list) and "a friend ledger" (the 1-on-1 expense group).

Alternatives considered:

- Keep "contacts" for the list and use a different name for the ledger: two terms for related concepts.
- Rename the ledger to something else and keep "contacts": the user chose "friends" for both.

### 10. Homepage: separate "Groups" and "Friends" sections, keep "Starred" mixed

The homepage's `partitionGroups` function and section rendering are restructured so that:

- **Starred** section: groups and friend ledgers with `preference.starred === true`, intermixed. Section heading unchanged ("Starred"). Starred items are pulled out of the Groups and Friends sections below (same as today's behavior for starred groups in Recent).
- **Groups** section: all active `GROUP`-type groups that are not starred, not archived, and not hidden. Section heading "Groups" (replaces "Recent"). Shows every group the user is an active member of.
- **Friends** section: all `FRIEND`-type groups that are not starred and not hidden. Section heading "Friends". Shows every friend ledger the user has, even if fully settled — a friend ledger with a zero balance is still a valid running relationship the user may want to add expenses to.
- **Archived** section: `GROUP`-type groups with `Group.archived === true` only. `FRIEND` groups never appear here (archive is not a friend concept).
- **Hidden** section: groups and friend ledgers with `preference.hidden === true`, intermixed (toggled via "Show hidden").

`bucketFor` in `group-buckets.ts` gains a `groupType` check: `FRIEND` groups skip the `archived` bucket even if `Group.archived` were somehow true (defense-in-depth). The partition function gains separate `groups` and `friends` arrays instead of the single `active` array.

Rationale: the user wants groups and friend ledgers to be visually distinct on the homepage — not mixed into a single "Recent" list. Separate "Groups" and "Friends" sections make it immediately clear what type of ledger each card is. Dropping the "Recent" label in favor of "Groups" is more descriptive (the section shows all groups, not just recent ones). The Starred section stays mixed because starring is a cross-type "favorites" concept.

### 11. Create-expense entry: section-level "Create expense" buttons with scope-picker dialogs

The homepage has two section-level "Create expense" buttons — one next to the "Groups" section heading and one next to the "Friends" section heading. Each button opens a `ResponsiveDialog` scope-picker listing only that section's items:

- **Groups section "Create expense" button**: opens a scope-picker dialog listing all the user's active groups (with `displayName`, member count, and currency). Selecting one navigates to `/groups/$groupId/expenses/create`.
- **Friends section "Create expense" button**: opens a scope-picker dialog listing all the user's friend ledgers (with `displayName`, pending indicator, and currency). Selecting one navigates to `/groups/$groupId/expenses/create`.

There are NO per-card "Create expense" buttons. The create-expense action is global per section, not per card.

When the user is already inside a group or friend ledger (the scope is known), the existing `+` button on the expense list page continues to navigate straight to the create-expense form — unchanged.

The scope-picker dialog reuses `ResponsiveDialog` (the app's standard dialog abstraction, desktop modal + mobile drawer). The list inside reuses `account.groups` data already fetched by the homepage, filtered by `groupType`.

Rationale: the user wants the create-expense action to be explicit and section-scoped, not duplicated on every card. A section-level button with a scope-picker keeps the cards compact while providing a clear entry point. The picker is scoped to one type at a time (groups or friends) so the user isn't choosing across a mixed list — the section context already tells them which type they're picking from.

Alternatives considered:

- Per-card "Create expense" buttons: the user explicitly reversed this — "no 'create expense' per group. the create expense is global for the entire group section."
- A single global "Create expense" button with a mixed scope-picker: the user wants it per-section, not global.
- `+` icon only (no text): less discoverable; the user wants the action to be explicit.
- In-dialog expense entry (form inside a modal): the existing expense form is large and complex; cramming it into a dialog would be a worse UX and a large refactor.

### 12. New `/friends/create` route with a bespoke form

A new web route `/friends/create` renders a form with:

- **Peer picker** (three tabs, mirroring the existing invite-card layout):
  - **Friends tab** (was "Contacts"): dropdown of `account.friends`, pick one. On submit, the direct-accept path fires (both members added immediately).
  - **Email tab**: email input + optional temporary name. On submit, the server looks up the email: if an `Account` exists, the direct-accept path fires; if not, the pending path fires (auto-accept invitation created).
  - **Link tab**: on submit, the group is created (caller only) and a link invite is generated. The user is navigated to the group page immediately, and the invite link is shown in a `ResponsiveDialog` on the group page itself.
- **Currency selector**: reuses the existing `CurrencySelector` component.
- **Optional info field**: an optional `Textarea` for notes about the friend ledger. Friends might want to add context (e.g. "Flatmate expenses" or "Trip to Lisbon"). Stored in `Group.information`.
- **No name field**: the name is server-derived (empty string; see Decision 5).

Submit calls a new `friends.create` tRPC mutation. On success:

- Direct-accept path (contact or email-with-account): navigate to `/groups/$groupId/expenses` (the friend ledger's expense list).
- Pending path (email without account): navigate to `/groups/$groupId/members` with a toast explaining the invitation was sent and will be auto-accepted when the peer signs up.
- Link path: navigate to `/groups/$groupId` (the group page). The group page detects that a link invite was just created and opens a `ResponsiveDialog` showing the invite URL for sharing.

If lookup-or-create returns an existing friend ledger, navigate directly to it without a toast. The user lands on the existing ledger seamlessly.

The regular `/groups/create` route is left untouched for multi-person groups.

Rationale: the user explicitly wants a new route, not a shared form with a toggle. The friend-create form is structurally different from the group-create form (peer picker instead of name field, no participants placeholder), so a bespoke component is cleaner. The info field is kept because friends might want to add context. The link path navigates to the group immediately (rather than staying on the create page) so the user sees the ledger they just created, with the invite link surfaced as a dialog on the group page.

Alternatives considered:

- Shared `/groups/create` with a "1-on-1" toggle: couples two different UXs in one component; the branching logic would be messy.
- Reuse the existing invite-card component inside the friend-create form: the invite card is designed for post-creation inviting (it calls `invitations.create` on an existing group). The friend-create flow needs to create the group AND invite in one step, so the card can't be reused as-is.
- Show the link URL on the create page (don't navigate): the user wants to see the ledger immediately, with the link as a secondary dialog on the group page.

### 13. `friends.create` tRPC procedure wraps `createGroup` with friend-specific logic

A new `friends` router with a `create` procedure. The procedure:

1. Validates input with a new `friendFormSchema` (peer selection + currency + optional info/temporaryName).
2. Resolves the peer: contact (`accountId`), email, or link.
3. Runs lookup-or-create logic (see Decision 2).
4. Calls a new `createFriendLedger` function in `lib/api/friends.ts` that wraps the existing `createGroup` transaction, adding the second member (direct-accept path) or the invitation (pending path), setting `groupType: FRIEND`, and setting `friendPairKey` (direct-accept path) or leaving `friendPairKey = null` (pending path).
5. Returns `{ groupId, existed: boolean }`.

`groups.create` does NOT gain a `groupType` input. All friend ledgers are created exclusively via `friends.create`, which contains the friend-specific logic (peer resolution, lookup-or-create, both-admin, friendPairKey). `groups.create` always creates `GROUP`-typed groups. The underlying `createGroup` transaction primitives (Ledger creation, GroupMember creation, LedgerParticipant creation) are shared/reused between the two paths — `createFriendLedger` calls the same low-level helpers as `createGroup`, with friend-specific additions layered on top. A few branches in the shared code are acceptable and preferable to a completely new concept.

Rationale: keeping friend-creation logic in a separate procedure and `lib/api/friends.ts` module avoids polluting `groups.ts` with type-conditional branching. The shared primitives (`createGroup`'s transaction body) can be extracted into a helper if needed, but the public API is split.

Alternatives considered:

- Add `groupType` to `groups.create` and branch there: couples friend-specific peer-picking logic into the group create procedure, making it harder to reason about.

## Risks / Trade-offs

- **[Risk] Race on auto-accept (email/link path).** Two concurrent auto-accepts for the same account pair could both try to set `friendPairKey` on the Group. **Mitigation:** the partial unique index on `Group.friendPairKey` makes the second update fail; the auto-accept transaction catches the unique violation and, since the first accept already created the peer's membership in the existing group, the second accept can either join the same group (if not already a member) or return "already a member."
- **[Risk] Pending friend invite to an email that belongs to an existing account.** Jack invites jane@example.com by email (Jane has an account but isn't in Jack's friends list). Later Jack picks Jane from friends. **Mitigation:** the direct-accept path looks up `Account` by email first — if the email resolves to an account, both members are added immediately and no invitation is created, so there's no pending duplicate. If Jack already created a pending invite (because the email lookup happened before Jane's account existed), the friends-list lookup also checks for any existing `FRIEND` group with a PENDING invitation to the contact's email; if found, return it instead of creating a duplicate.
- **[Risk] Auto-accept bypasses user consent.** A friend ledger appears on the peer's home screen without them clicking "Accept." **Mitigation:** this is by design — the user explicitly wants friend ledgers to be "accepted by default." The ledger is harmless (no expenses exist until someone creates one). The peer sees the friend ledger in their Friends section on the homepage. The peer can hide it if they don't want it visible.
- **[Risk] Dropping `pinned` column loses data.** **Mitigation:** `pinned` is never read or toggled anywhere in the app (verified by grep). The column is always `false` for all rows. No live data is lost.
- **[Risk] "Friends" rename causes confusion for existing users.** **Mitigation:** the "Contacts" tab was only visible on the group members invite page. The rename is a label change; no behavior changes. Translation updates via `bun i18n` CLI.
- **[Risk] Friend ledgers accumulate for users who interact with many people.** Since leaving is disallowed and creation is idempotent, a user with 50 contacts could have 50 friend ledgers. **Mitigation:** the Hidden preference lets users hide inactive friend ledgers. The lookup-or-create means re-interacting with a hidden friend reuses the hidden ledger (which can be unhidden).
- **[Trade-off] `Group.name` for friend ledgers is an empty string.** This is fine because it's never shown to users (`displayName` is computed for all API responses). Raw DB queries that read `Group.name` will see `""` for friend ledgers — acceptable since no code path relies on `name` being non-empty for `FRIEND` groups.

## Migration Plan

1. **Schema migration** (single Prisma migration):
   - Add `GroupType` enum (`GROUP`, `FRIEND`).
   - Add `Group.groupType` column with `@default(GROUP)`.
   - Add `Group.friendPairKey` column (nullable String) with a partial unique index for FRIEND-type groups.
   - `UPDATE account_group_preference SET hidden = hidden OR archived;`
   - Drop `AccountGroupPreference.archived` column.
   - Drop `AccountGroupPreference.pinned` column.
2. **Regenerate Prisma client** (`bun prisma-generate`).
3. **API changes:**
   - Add `lib/api/friends.ts` with `createFriendLedger` (direct-accept + pending branches, lookup-or-create, `friendPairKey` management).
   - Add `friends` router with `create` procedure.
   - Extend `account.groups` to return `groupType` and per-viewer `displayName`.
   - Branch group mutation procedures (`groups.update` (name field only), `groups.archive`, `groups.delete`, `groups.leave`/`members.leave`, `invitations.create`, `invitations.createLink`, `invitations.revoke`) on `groupType` and reject `FRIEND` where applicable. `groups.update` for `FRIEND` allows `information` and `currency`/`currencyCode` changes but rejects `name` changes.
   - Update `invitations.previewLink` to show a FRIEND-aware display name ("Friend ledger with {inviter name}") instead of `Group.name` for `FRIEND` groups.
   - Rename `account.contacts` → `account.friends`; enrich results with "friend ledger already exists" metadata.
   - Update `account.preferences` and `account.setPreference` to drop `pinned`.
   - Add auto-accept hook for friend invitations: on signup, auto-accept PENDING friend invitations matching the new account's email; on link-open, auto-accept the friend link invitation.
   - Filter friend invitations out of `invitations.listForAccount` (no user-facing pending state for friends).
4. **Domain changes:**
   - Add `friendFormSchema` (peer selection + currency + optional info/temporaryName).
5. **Web changes:**
   - Add `/friends/create` route and form component.
   - Update `GroupCard` to render `displayName`, add "Create expense" button, and hide `FRIEND`-inapplicable actions.
   - Update `partitionGroups` / `bucketFor` to split into separate `groups` and `friends` arrays and skip the `archived` bucket for `FRIEND`.
   - Rename "Contacts" → "Friends" in the invite UI and all copy.
   - Update `AccountGroup` type to reflect the new `preference` shape.
6. **Translations:** use `bun i18n` CLI to add friend-ledger copy and rename contacts→friends in `en-US.json`; dispatch parallel subagents for other locales.
7. **Tests:** API integration tests for `friends.create` (direct-accept with contact, direct-accept with email-that-has-account, pending with email-without-account, link path, lookup-or-create idempotency, both-admin membership, restricted actions); auto-accept tests (email signup triggers auto-accept, link-open triggers auto-accept); `previewLink` FRIEND-aware display name test; web tests for homepage section splitting (Groups vs Friends), friend card rendering (displayName, avatar, pending badge), section-level "Create expense" scope-picker dialogs, and the migration data-preservation check.

Rollback strategy: the `GroupType` default and `friendPairKey` nullability make the schema changes backward-compatible — existing code that doesn't know about `groupType` treats everything as `GROUP`, and `friendPairKey` is only set for `FRIEND` groups. The `AccountGroupPreference` column drops are the only irreversible part; back up the table before the migration. If the feature needs to be rolled back after migration, friend-ledger groups can be deleted (they have no unique data not derivable from the pair) and the code reverted.

## Resolved Questions

- **`account.friends` enrichment**: the query returns `hasFriendLedger` metadata for each friend, indicating whether a FRIEND-typed group with a matching `friendPairKey` (or a pending `FRIEND` email invitation) already exists between the caller and that account.
- **Friend card pending indicator**: friend ledger cards with a PENDING invitation (peer hasn't joined yet) SHALL show a subtle "Pending" badge, consistent with the app's existing styling for pending states.
- **Friend card avatar**: FRIEND cards SHALL show the peer's avatar (using `Account.image` if set, falling back to initials) to the left of the `displayName`. GROUP cards show no avatar (unchanged). `Account.image` is not widely set today; initials are the primary fallback.
- **Friend ledger detail page tabs**: FRIEND groups hide the Members tab (just 2 people, shown on the card). Settings tab is shown with the name field hidden/disabled but currency and information editable. Expenses, Balances, Activity tabs are shown unchanged.
- **Empty friends list in `/friends/create`**: empty state copy reads "No friends yet. Invite someone by email or share a link." with a pointer to the Email/Link tabs.
- **Existing ledger on submit**: navigating to the existing friend ledger directly, no toast.
- **Expenses before peer joins**: the caller can create expenses involving the pending peer's pre-materialized `LedgerParticipant` before the peer signs up. This is intentional — the caller can start logging expenses immediately.
