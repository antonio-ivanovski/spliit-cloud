## MODIFIED Requirements

### Requirement: Membership-based group access
The system SHALL grant group access only to authenticated accounts that have active group membership or a pending invitation that can be accepted. For `FRIEND`-typed groups, pending invitations SHALL be auto-accepted by the system and SHALL NOT present any user-facing Accept or Decline UI.

#### Scenario: Member opens group
- **WHEN** an authenticated account with active membership opens a group
- **THEN** the system grants access to the group

#### Scenario: Pending invitee opens group (GROUP-typed)
- **WHEN** an authenticated account with a pending invitation on a `GROUP`-typed group opens the group
- **THEN** the system grants read-only access to the group including expenses, balances, stats, activities, and the information page
- **AND** the system SHALL reject any mutation: expense create/update/delete, group update/archive, invitation create/revoke/list
- **AND** the UI SHALL hide all edit affordances (create buttons, edit buttons, export, receipt upload) and SHALL surface an Accept/Decline banner

#### Scenario: Pending invitee opens friend ledger (FRIEND-typed)
- **WHEN** an authenticated account with a pending invitation on a `FRIEND`-typed group opens the group via a link invite URL
- **THEN** the system SHALL auto-accept the invitation immediately (create the second ADMIN/ACTIVE member, create the `FriendLink`, flip invitation to `ACCEPTED`)
- **AND** the system SHALL NOT present any Accept or Decline banner
- **AND** the account SHALL gain full member access (not read-only)

#### Scenario: Friend invitation auto-accepts on signup
- **WHEN** a new account signs up with an email that matches a `PENDING` `EMAIL` invitation on a `FRIEND`-typed group
- **THEN** the system SHALL auto-accept the invitation as part of the signup flow
- **AND** the system SHALL NOT present any Accept or Decline UI

#### Scenario: Non-member opens group URL
- **WHEN** an authenticated account without active membership or a pending invitation opens a group URL
- **THEN** the system denies access to the group

#### Scenario: Removed member opens group activity
- **WHEN** an authenticated account whose membership status is LEFT or REMOVED opens group activity
- **THEN** the system denies access to the group activity

#### Scenario: Revoked invitee opens group activity
- **WHEN** an authenticated account whose invitation is revoked opens group activity
- **THEN** the system denies access to the group activity

### Requirement: Group deletion with document cleanup
The system SHALL allow ADMIN members to permanently delete a group, its ledger, expenses, invitations, and attached S3 documents. The system SHALL reject deletion of archived groups. The system SHALL reject deletion of `FRIEND`-typed groups.

#### Scenario: Delete group cleans up S3 documents
- **WHEN** an ADMIN permanently deletes a `GROUP`-typed group
- **THEN** the system first queries all expense documents for the group's ledger and deletes each S3 object
- **AND** then permanently deletes the group, cascading to all ledger data including expenses, invitations, and activity history

#### Scenario: Delete group rejected for archived groups
- **WHEN** an ADMIN attempts to delete an already-archived group
- **THEN** the system rejects the operation with FORBIDDEN (the group is already read-only)

#### Scenario: Delete group restricted to ADMINS
- **WHEN** a non-admin member attempts to delete the group
- **THEN** the system rejects the operation with FORBIDDEN

#### Scenario: Delete group rejected for FRIEND-typed groups
- **WHEN** an ADMIN attempts to delete a `FRIEND`-typed group
- **THEN** the system rejects the operation with FORBIDDEN and a `friendLedgerNotDeletable` reason

## ADDED Requirements

### Requirement: Friend ledger restricted actions
The system SHALL reject the following mutations on `FRIEND`-typed groups by branching on `groupType`: group rename (`groups.update` with `name` field changes), archive/unarchive (`groups.archive`), group deletion (`groups.delete`), member leave (`groups.leave`/`members.leave`), creating additional invitations (`invitations.create`, `invitations.createLink`), and revoking pending invitations (`invitations.revoke`). The system SHALL allow `groups.update` for `FRIEND` groups when only `information` and/or `currency`/`currencyCode` fields are changed. The system SHALL allow starring, hiding, and all expense operations on `FRIEND`-typed groups.

#### Scenario: Rename rejected for FRIEND group
- **WHEN** an ADMIN attempts to change the `name` of a `FRIEND`-typed group via `groups.update`
- **THEN** the system rejects the operation with FORBIDDEN and a `friendLedgerNotRenamable` reason

#### Scenario: Currency and information editable for FRIEND group
- **WHEN** an ADMIN attempts to change the `currency`, `currencyCode`, or `information` of a `FRIEND`-typed group via `groups.update`
- **THEN** the system SHALL allow the operation (these fields remain editable)

#### Scenario: Archive rejected for FRIEND group
- **WHEN** an ADMIN attempts to archive or unarchive a `FRIEND`-typed group via `groups.archive`
- **THEN** the system rejects the operation with FORBIDDEN and a `friendLedgerNotArchivable` reason

#### Scenario: Leave rejected for FRIEND group
- **WHEN** a member attempts to leave a `FRIEND`-typed group
- **THEN** the system rejects the operation with FORBIDDEN and a `friendLedgerNotLeavable` reason

#### Scenario: Additional invitations rejected for FRIEND group
- **WHEN** an ADMIN attempts to create an additional email or link invitation on a `FRIEND`-typed group
- **THEN** the system rejects the operation with FORBIDDEN and a `friendLedgerFull` reason

#### Scenario: Invitation revocation rejected for FRIEND group
- **WHEN** an ADMIN attempts to revoke a pending invitation on a `FRIEND`-typed group
- **THEN** the system rejects the operation with FORBIDDEN and a `friendLedgerNotRevocable` reason

#### Scenario: Star and hide allowed for FRIEND group
- **WHEN** a member stars or hides a `FRIEND`-typed group via `account.setPreference`
- **THEN** the system SHALL allow the operation (star and hide are per-account preferences, independent of group type)

#### Scenario: Expense operations allowed for FRIEND group
- **WHEN** a member creates, edits, or deletes an expense in a `FRIEND`-typed group
- **THEN** the system SHALL allow the operation (expense operations are unchanged for friend ledgers)

### Requirement: Friend ledger both-admin membership
The system SHALL create both members of a `FRIEND`-typed group with role `ADMIN`. In the direct-accept path, both members are created as ADMIN/ACTIVE at creation time. In the pending path, the caller is ADMIN/ACTIVE at creation time and the peer becomes ADMIN/ACTIVE on auto-accept (via the invitation's `role: ADMIN`).

#### Scenario: Direct-accept path creates both members as ADMIN
- **WHEN** the system creates a friend ledger via the direct-accept path
- **THEN** both `GroupMember` rows SHALL have role `ADMIN` and status `ACTIVE`

#### Scenario: Pending path creates caller as ADMIN, peer becomes ADMIN on auto-accept
- **WHEN** the system creates a friend ledger via the pending path
- **THEN** the caller's `GroupMember` SHALL have role `ADMIN` and status `ACTIVE`
- **AND** the invitation SHALL have role `ADMIN`
- **AND** on auto-accept, the peer's `GroupMember` SHALL be created with role `ADMIN` and status `ACTIVE`
