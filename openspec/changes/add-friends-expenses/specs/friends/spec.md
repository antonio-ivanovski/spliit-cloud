## ADDED Requirements

### Requirement: Friend ledger creation via direct-accept path
The system SHALL allow an authenticated account to create a 1-on-1 friend expense ledger with another account that can be resolved to a known `accountId` — either by selecting from the friends list or by entering an email that belongs to an existing `Account`. The system SHALL create the ledger as a `FRIEND`-typed group with both accounts as ACTIVE `ADMIN` members immediately, with no invitation step and no accept action.

#### Scenario: Create friend ledger by selecting a friend
- **WHEN** an authenticated account selects a friend from the friends list and creates a friend ledger
- **THEN** the system creates a `FRIEND`-typed group with a `Ledger` using the selected currency
- **AND** the system creates two `GroupMember` rows, both with role `ADMIN` and status `ACTIVE`
- **AND** the system sets `friendPairKey` on the Group keyed by the unordered account pair
- **AND** the system creates a `LedgerParticipant` for each member
- **AND** the system SHALL NOT create any `GroupInvitation`
- **AND** the ledger SHALL appear on both accounts' home screens on their next load

#### Scenario: Create friend ledger by entering an email that belongs to an existing account
- **WHEN** an authenticated account enters an email that matches an existing `Account` and creates a friend ledger
- **THEN** the system looks up the `Account` by email
- **AND** if an account is found, the system SHALL proceed as if the peer were selected from the friends list (direct-accept path with both members added immediately)
- **AND** the system SHALL NOT create an invitation even though the email was entered manually

#### Scenario: Lookup-or-create returns existing friend ledger
- **WHEN** an authenticated account attempts to create a friend ledger with a peer that already has a friend ledger with the caller
- **THEN** the system SHALL return the existing friend ledger instead of creating a new one
- **AND** the response SHALL indicate that the ledger already existed
- **AND** the system SHALL NOT create any duplicate groups, members, or `friendPairKey` collisions
- **AND** the system SHALL check for existing groups in both directions: (a) by `friendPairKey` match, (b) by the caller's pending invitations, and (c) by the peer's pending invitations (cross-direction lookup — handles the case where the peer created a group with a PENDING EMAIL invite for the caller's email before the caller's account existed)

#### Scenario: Friend ledger name is empty and never shown
- **WHEN** the system creates a `FRIEND`-typed group
- **THEN** the system SHALL set the `Group.name` column to an empty string
- **AND** the system SHALL compute a per-viewer `displayName` for all API responses instead of using `Group.name`

### Requirement: Friend ledger creation via pending path with auto-accept
The system SHALL allow an authenticated account to create a friend ledger with a peer that cannot be resolved to a known `accountId` (email without an existing account, or a link invite). The system SHALL create the ledger with the caller as the only ADMIN/ACTIVE member and a `PENDING` invitation for the peer. The invitation SHALL be auto-accepted by the system when the peer's account becomes available — with no user-facing Accept or Decline action.

#### Scenario: Create friend ledger by entering an email without an existing account
- **WHEN** an authenticated account enters an email that does not match any existing `Account` and creates a friend ledger
- **THEN** the system creates a `FRIEND`-typed group with the caller as ADMIN/ACTIVE
- **AND** the system creates a `PENDING` `GroupInvitation` of type `EMAIL` with role `ADMIN` targeting the entered email
- **AND** the system SHALL leave `friendPairKey` as `null` (it is set when the peer joins)
- **AND** the optional `temporaryName` provided in the form SHALL be stored on the invitation and used as the display name while pending
- **AND** the system SHALL send a notification email (NOT an invitation with an accept link) to the peer's email encouraging them to create an account
- **AND** the caller SHALL be navigated to the group page with a confirmation toast

#### Scenario: Create friend ledger with email that resolves to existing account also sends notification
- **WHEN** an authenticated account enters an email that belongs to an existing `Account` and creates a friend ledger
- **THEN** the system SHALL proceed with the direct-accept path (both members added immediately)
- **AND** the system SHALL send a notification email (NOT an invitation) to the peer's account email informing them of the new friend ledger
- **AND** the caller SHALL be navigated to the group expenses page (direct-accept, no pending state)

#### Scenario: Create friend ledger via link invite
- **WHEN** an authenticated account chooses the link path to create a friend ledger
- **THEN** the system creates a `FRIEND`-typed group with the caller as ADMIN/ACTIVE
- **AND** the system creates a `PENDING` `GroupInvitation` of type `LINK` with role `ADMIN`
- **AND** the system generates a link token and returns the invite URL to the caller
- **AND** the caller SHALL be navigated to the group page immediately, with the invite link shown in a dialog on the group page

#### Scenario: Auto-accept on signup with matching email
- **WHEN** a new account signs up with an email that matches a `PENDING` `EMAIL` invitation on a `FRIEND`-typed group
- **THEN** the system SHALL auto-accept the invitation: create the second `GroupMember` as ADMIN/ACTIVE, set the `friendPairKey` on the Group, flip the invitation to `ACCEPTED`
- **AND** the system SHALL NOT present any Accept or Decline UI to the peer
- **AND** the friend ledger SHALL appear on the peer's home screen on their next load

#### Scenario: Auto-accept on link open
- **WHEN** an authenticated account opens a link invite URL for a `FRIEND`-typed group with a valid PENDING link token
- **THEN** the `groups.get` procedure SHALL detect the FRIEND group type, auto-accept the invitation server-side, and return the user as an active member (no Accept/Decline banner)
- **AND** the system SHALL create the second `GroupMember` as ADMIN/ACTIVE, set the `friendPairKey` on the Group, flip the invitation to `ACCEPTED`
- **AND** the system SHALL NOT present any Accept or Decline UI to the peer
- **AND** the friend ledger SHALL appear on the peer's home screen

#### Scenario: Friend invitations do not appear in pending invitations list
- **WHEN** the system queries `invitations.listForAccount` for the homepage pending invitations card
- **THEN** the system SHALL exclude invitations that belong to `FRIEND`-typed groups
- **AND** the peer SHALL NOT see a pending invitation card on their home screen for friend ledgers

### Requirement: Per-pair friend ledger uniqueness
The system SHALL enforce at most one `FRIEND`-typed group per unordered account pair via a `friendPairKey` column on `Group` with a partial unique index (`WHERE "friendPairKey" IS NOT NULL AND "groupType" = 'FRIEND'`). The key format is `"accountAId:accountBId"` where `accountAId` is always the lexicographically smaller account ID.

#### Scenario: friendPairKey set when both members join
- **WHEN** the system creates a friend ledger via the direct-accept path
- **THEN** the system SHALL set `friendPairKey` on the Group using the smaller-id-first convention
- **AND** the partial unique index SHALL prevent inserting a duplicate pair key

#### Scenario: friendPairKey set on auto-accept
- **WHEN** the system auto-accepts a pending friend invitation
- **THEN** the system SHALL set `friendPairKey` on the Group inside the accept transaction

#### Scenario: Duplicate friend ledger creation is rejected by the database
- **WHEN** two concurrent friend ledger creations for the same account pair slip past the application-level lookup
- **THEN** the partial unique index on `Group.friendPairKey` SHALL cause the second write to fail
- **AND** the system SHALL return the existing friend ledger to the failed caller

### Requirement: Friend ledger display name resolution
The system SHALL compute a per-viewer `displayName` for each `FRIEND`-typed group returned by the `account.groups` query. The display name SHALL be the OTHER member's display name, resolved via the priority chain using truthiness fallback (`||`): the peer's `Account.name` (if truthy) → `Invitation.temporaryName` (if truthy) → `Invitation.email`. The use of `||` (rather than `??`) ensures that empty strings and `null` both fall through, consistent with the group page's `resolveDisplayName`.

#### Scenario: Both members active — display name is the other's account name
- **WHEN** the system returns a `FRIEND`-typed group where both members are ACTIVE
- **THEN** the `displayName` for each viewer SHALL be the OTHER member's `Account.name`

#### Scenario: Pending invitation with temporary name
- **WHEN** the system returns a `FRIEND`-typed group where the peer has a `PENDING` invitation with a `temporaryName`
- **THEN** the `displayName` for the caller SHALL be the invitation's `temporaryName`

#### Scenario: Pending invitation without temporary name
- **WHEN** the system returns a `FRIEND`-typed group where the peer has a `PENDING` invitation without a `temporaryName`
- **THEN** the `displayName` for the caller SHALL be the invitation's `email`

#### Scenario: GROUP-typed groups use their own name
- **WHEN** the system returns a `GROUP`-typed group
- **THEN** the `displayName` SHALL equal `Group.name` (unchanged behavior)

### Requirement: Friend ledger link preview display name
The system SHALL compute a FRIEND-aware display name for the public `invitations.previewLink` procedure when the invitation belongs to a `FRIEND`-typed group. Since `Group.name` is an empty string for friend ledgers, the preview SHALL show "Friend ledger with {inviter name}" where the inviter name is resolved from the inviter's `Account.name` via `invitedById`.

#### Scenario: Unauthenticated user opens a friend ledger link invite
- **WHEN** an unauthenticated user opens a link invite URL for a `FRIEND`-typed group and the system processes `invitations.previewLink`
- **THEN** the preview SHALL show "Friend ledger with {inviter's Account.name}" as the group display name
- **AND** the preview SHALL NOT show an empty string for the group name

#### Scenario: Unauthenticated user opens a regular group link invite
- **WHEN** an unauthenticated user opens a link invite URL for a `GROUP`-typed group
- **THEN** the preview SHALL show `Group.name` as the group display name (unchanged behavior)

### Requirement: Friend ledger pending indicator on home screen
The system SHALL indicate pending state on friend ledger cards on the home screen when the peer has not yet joined (the friend ledger has a PENDING invitation and only one ACTIVE member). The indicator SHALL be subtle and consistent with the app's existing styling for pending states.

#### Scenario: Pending friend ledger shows pending indicator
- **WHEN** the system renders a friend ledger card on the home screen where the peer has a PENDING invitation
- **THEN** the card SHALL display a "Pending" badge or muted styling indicating the peer has not joined yet

#### Scenario: Active friend ledger shows no pending indicator
- **WHEN** the system renders a friend ledger card on the home screen where both members are ACTIVE
- **THEN** the card SHALL NOT display a pending indicator
