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
- **WHEN** an authenticated account with a pending `LINK` invitation on a `FRIEND`-typed group opens the group via a link invite URL
- **THEN** the `groups.get` procedure SHALL detect the FRIEND group type and call `acceptLinkInvitation` server-side before returning the payload (no Accept/Decline UI)
- **AND** the system SHALL create the second ADMIN/ACTIVE member, set the `friendPairKey` on the Group, flip invitation to `ACCEPTED`
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

## ADDED Requirements

### Requirement: Membership activity recording
The system SHALL record structured activity for member leave, member removal, and member role changes.

#### Scenario: Last member cannot leave — must delete or archive
- **WHEN** the last active member attempts to leave a group
- **THEN** the system rejects the leave with a PRECONDITION_FAILED error and `lastMemberMustDelete` reason, steering the caller to the dedicated delete flow on the settings page
- **AND** the system provides an `archiveGroupForSelf` mutation as a non-destructive alternative that sets the group as archived (read-only) while preserving the membership, ledger, expenses, and activity history

#### Scenario: Member leaves (not last member)
- **WHEN** an active member who is not the last active member leaves a group
- **THEN** the system records MEMBER_LEFT activity with actor identity and member display metadata
- **AND** if settlement expenses are created during leave, the system dispatches EXPENSE_CREATED notifications for each settlement

#### Scenario: Leave preview provides precondition state
- **WHEN** a member opens the leave-group dialog
- **THEN** the system returns a preview indicating whether the caller is the last active member, the last admin, or has unsettled balances, so the dialog can render the appropriate copy

#### Scenario: Member removed
- **WHEN** an admin removes an active member from a group
- **THEN** the system records MEMBER_REMOVED activity with actor identity and removed member display metadata
- **AND** if settlement expenses are created during removal, the system dispatches EXPENSE_CREATED notifications for each settlement

#### Scenario: Member role changed
- **WHEN** an admin changes another active member's role
- **THEN** the system records MEMBER_ROLE_CHANGED activity with actor identity, target member display metadata, previous role, and new role

### Requirement: Invitation activity recording
The system SHALL record structured activity for invitation creation, revocation, acceptance, and decline.

#### Scenario: Invitation created
- **WHEN** an admin creates an email or link invitation
- **THEN** the system records INVITATION_CREATED activity with actor identity, invitation display label, invitation type, and invited role

#### Scenario: Invitation revoked
- **WHEN** an admin revokes a pending invitation
- **THEN** the system records INVITATION_REVOKED activity with actor identity and invitation display label

#### Scenario: Invitation accepted
- **WHEN** an invitee accepts an email or link invitation
- **THEN** the system records INVITATION_ACCEPTED activity with invitee actor identity and invitation display label

#### Scenario: Invitation declined
- **WHEN** an invitee declines an email invitation
- **THEN** the system records INVITATION_DECLINED activity with invitee actor identity and invitation display label

### Requirement: Group settings and archive activity recording
The system SHALL record structured activity for group settings and group archive state changes. Group update activities MAY include per-field `before`/`after` display strings for changed fields (name, information, currency).

#### Scenario: Group settings updated with before/after changes
- **WHEN** an admin updates group settings
- **THEN** the system records GROUP_UPDATED activity with actor identity, changed field names, and per-field `before`/`after` display strings

#### Scenario: Linked participant change activity
- **WHEN** an unlinked participant is linked to an account or a pending invitation
- **THEN** the system records GROUP_UPDATED activity with `linkedParticipant` changed field and before/after participant name display strings

#### Scenario: Group archived
- **WHEN** an admin archives a group
- **THEN** the system records GROUP_ARCHIVED activity with actor identity
- **AND** if settlement expenses are created during archive, the system dispatches EXPENSE_CREATED notifications for each settlement

#### Scenario: Group unarchived
- **WHEN** an admin unarchives a group
- **THEN** the system records GROUP_UNARCHIVED activity with actor identity

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

## ADDED Requirements

### Requirement: Pending invitation management
The system SHALL allow admins and invitation creators to manage PENDING invitations in place — retarget the recipient email, convert between EMAIL and LINK delivery, edit the pending display name and role, and rotate link credentials — without losing the invitation row, its materialized ledger participant, expenses, balances, or subgroup links.

#### Scenario: List surfaces manage and revoke eligibility
- **WHEN** a member loads the group members page
- **THEN** `invitations.list` SHALL return the pending invitations visible to the caller: all invitations for admins, invitations the caller created for members
- **AND** each row SHALL include `canManage`, `canRevoke`, `recipientProfile` (the account matching the invitation email, when one exists), `ledgerParticipantId`, and `expiresAt`

#### Scenario: Manage permissions by role
- **WHEN** an admin updates a pending invitation
- **THEN** the system SHALL allow managing any listed invitation and assigning `ADMIN` or `MEMBER`
- **WHEN** a member updates a pending invitation they created
- **THEN** the system SHALL allow managing it but SHALL reject assigning `ADMIN`

#### Scenario: Manage rejected for archived, friend-ledger, and resolved invitations
- **WHEN** the group is archived, the group is `FRIEND`-typed, or the invitation is not `PENDING`
- **THEN** the system SHALL reject `updatePending` and `regenerateLink` with FORBIDDEN

#### Scenario: Update validates like create
- **WHEN** an update retargets the email or switches delivery to EMAIL
- **THEN** the system SHALL apply the same validations as invitation creation: no self-invite, no existing active member, and no conflicting pending email invitation (excluding the invitation being edited)

#### Scenario: Concurrent resolution cannot race an update
- **WHEN** an invitation is accepted or revoked while an update is in flight
- **THEN** the update SHALL fail because the conditional PENDING write updates zero rows
- **AND** the system SHALL NOT revive or double-accept the invitation

#### Scenario: EMAIL to LINK conversion
- **WHEN** a pending EMAIL invitation is converted to LINK delivery
- **THEN** the system SHALL generate a fresh one-time credential and expiry and return the shareable URL exactly once in the response

#### Scenario: LINK to EMAIL conversion
- **WHEN** a pending LINK invitation is converted to EMAIL delivery
- **THEN** the system SHALL clear the link credential so the previous URL stops working immediately
- **AND** the system SHALL send the invitation email to the new recipient

#### Scenario: Metadata-only saves do not resend or rotate
- **WHEN** only the display name or role changes (or an unchanged EMAIL destination is re-saved)
- **THEN** the system SHALL NOT resend the invitation email and SHALL NOT rotate an existing link credential

#### Scenario: Invitation update recorded
- **WHEN** a pending invitation is updated or a link credential is regenerated
- **THEN** the system SHALL record one secret-free `INVITATION_UPDATED` activity listing the changed fields (delivery type, destination, display name, role, or credential)

### Requirement: Link invitation credential rotation
The system SHALL support rotating a pending link invitation's credential, invalidating the old URL immediately while preserving the invitation, ledger participant, and related data.

#### Scenario: Regenerate link invalidates the old URL
- **WHEN** the credential of a pending LINK invitation is regenerated
- **THEN** the old URL SHALL become unusable immediately (rejected as no longer valid)
- **AND** the response SHALL return the new shareable URL exactly once with a fresh expiry

#### Scenario: Regenerate rejected for email invitations
- **WHEN** a caller attempts to regenerate the credential of an EMAIL invitation
- **THEN** the system SHALL reject the operation

### Requirement: Personal email invitations take precedence over link tokens
The system SHALL treat a PENDING email invitation for the account's email as the recipient-specific credential over any URL-borne link token for the same group.

#### Scenario: Link acceptance blocked while an email invitation is pending
- **WHEN** an account with a PENDING email invitation for the group attempts to redeem a link invitation token
- **THEN** the system SHALL reject the link acceptance, directing the user to their email invitation
- **AND** the link invitation SHALL remain untouched and usable by other accounts

#### Scenario: Group view surfaces the email invitation
- **WHEN** a non-member opens the group with a link token in the URL while a PENDING email invitation matches their account email
- **THEN** `groups.get` SHALL return the email invitation as `currentInvitation` and `linkInviteState` null
- **AND** the UI SHALL present the email-invitation Accept/Decline banner and SHALL NOT render link-banner copy (inviter name, single-use note, or the link's temporary name)

#### Scenario: Friend ledger auto-accept skipped for email-invited accounts
- **WHEN** the account has a PENDING email invitation on a `FRIEND`-typed group and opens it via a link token
- **THEN** the system SHALL NOT auto-accept the link and SHALL present the email invitation instead

### Requirement: Expired link invitations remain listed and manageable
The system SHALL keep PENDING link invitations whose expiry has passed in the pending list and SHALL allow managing and regenerating them.

#### Scenario: Expired link invitation stays listed with an Expired badge
- **WHEN** a pending link invitation's `expiresAt` has passed
- **THEN** the invitation SHALL remain in the pending list and the members UI SHALL mark it as Expired
- **AND** the invitation SHALL NOT be redeemable until it is regenerated

#### Scenario: Regeneration restores usability
- **WHEN** an expired link invitation is regenerated
- **THEN** the new URL SHALL be usable and the old URL SHALL remain dead

### Requirement: Pending invitation management UI
The system SHALL render pending invitations with per-row management actions and a manage dialog supporting delivery, name, and role edits.

#### Scenario: Row actions
- **WHEN** a pending invitation row is rendered
- **THEN** the row SHALL show a Manage action
- **AND** LINK invitations with `canManage` SHALL additionally show a Generate new link action
- **AND** rows with `canRevoke` SHALL show a destructive Revoke action

#### Scenario: Manage dialog delivery tabs
- **WHEN** a manager opens the manage dialog
- **THEN** the dialog SHALL offer Friends, Email, and Link delivery tabs
- **AND** selecting a friend SHALL target EMAIL delivery at the friend's account email and profile name
- **AND** switching between email and link delivery SHALL relabel the save action accordingly (Update & send / Switch & generate link)

#### Scenario: Role control is admin-only
- **WHEN** the manager is not an admin
- **THEN** the dialog SHALL NOT render the role control and the save SHALL keep the existing role

#### Scenario: Matched account profile locks the display name
- **WHEN** the invitation email matches an existing account
- **THEN** the dialog SHALL show the account profile name as locked rather than editable

#### Scenario: Email change warning
- **WHEN** the manager changes the destination email or switches a LINK invitation to EMAIL
- **THEN** the dialog SHALL warn that the current recipient can no longer accept and the invitation email will be (re)sent

#### Scenario: Friends picker excludes members and other pending invitees
- **WHEN** the friends picker renders
- **THEN** friends who are already members or already have another pending invitation in the group SHALL be disabled
- **AND** the friend whose pending invitation is being managed SHALL remain selectable

#### Scenario: Role and friend pickers show human-readable labels
- **WHEN** a role select or the friend picker is closed
- **THEN** the trigger SHALL display the translated role label or friend name rather than a raw value or identifier

#### Scenario: Link result is shown once
- **WHEN** a save generates a new link (EMAIL to LINK conversion or regeneration)
- **THEN** the dialog SHALL display the shareable URL in a copyable result view with its expiry and a warning that it cannot be shown again
