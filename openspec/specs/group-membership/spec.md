## ADDED Requirements

### Requirement: Membership-based group access
The system SHALL grant group access only to authenticated accounts that have group membership or a pending invitation that can be accepted.

#### Scenario: Member opens group
- **WHEN** an authenticated account with active membership opens a group
- **THEN** the system grants access to the group

#### Scenario: Pending invitee opens group
- **WHEN** an authenticated account with a pending invitation opens a group
- **THEN** the system grants read-only access to the group including expenses, balances, stats, activities, and the information page
- **AND** the system SHALL reject any mutation: expense create/update/delete, group update/archive, invitation create/revoke/list
- **AND** the UI SHALL hide all edit affordances (create buttons, edit buttons, export, receipt upload) and SHALL surface an Accept/Decline banner

#### Scenario: Non-member opens group URL
- **WHEN** an authenticated account without membership opens a group URL
- **THEN** the system denies access to the group

### Requirement: Group roles
The system SHALL support group roles for OWNER, ADMIN, and MEMBER.

#### Scenario: Owner manages group
- **WHEN** an OWNER updates group settings or manages members
- **THEN** the system allows the operation

#### Scenario: Member manages restricted settings
- **WHEN** a MEMBER attempts an owner/admin-only operation
- **THEN** the system rejects the operation

### Requirement: Email invitations
The system SHALL support group invitations by email and SHALL accept invitations only for matching authenticated email identities unless an owner or admin changes the invite.

#### Scenario: Invited email accepts
- **WHEN** a user authenticates with the invited email and accepts the invitation
- **THEN** the system creates or activates group membership for that account

#### Scenario: Different email attempts acceptance
- **WHEN** a user authenticates with a different email than the invitation target
- **THEN** the system does not automatically accept the invitation

#### Scenario: Click pending invitation in groups list
- **WHEN** an authenticated account clicks a pending invitation row on the /groups page
- **THEN** the system navigates to the group page with read-only access and the Accept/Decline banner
- **AND** clicking the group name or any non-button area of the row SHALL navigate to the group
- **AND** the Accept and Decline buttons SHALL still work without navigating

### Requirement: Unlinked participants have no access

The system SHALL distinguish authenticated group members from unlinked LedgerParticipants and SHALL NOT grant group access to unlinked participants.

#### Scenario: Unlinked participant exists

- **WHEN** an imported group contains an unlinked participant entry
- **THEN** that entry can appear in expenses and balances but cannot sign in or access the group

### Requirement: Admin mapping correction

The system SHALL allow group owners or admins to correct participant mappings when needed.

#### Scenario: Admin maps unlinked participant

- **WHEN** an owner or admin maps an unlinked participant entry to an account
- **THEN** the system links the LedgerParticipant to that account and creates or activates group membership if needed

### Requirement: Admin role is preserved on reactivation

When an unlinked participant is linked to an account that was a prior member, the system SHALL preserve the account's previous role (ADMIN or MEMBER) rather than defaulting to MEMBER.

#### Scenario: Rejoining admin retains admin role

- **WHEN** an admin's membership is reactivated during the unlinked-participant link flow
- **THEN** the `GroupMember.role` is preserved (not demoted to MEMBER)
- **THEN** the admin retains their administrative privileges in the group

### Requirement: Source group note and URL attribution

The system SHALL compose an "Imported from:" attribution note using the `appendImportedFromNote` helper and pre-fill the destination group's information field with it.

#### Scenario: New group gets source URL attribution

- **WHEN** the user creates a new group from a Spliit URL import
- **THEN** the destination step pre-fills the group information text area with `Imported from: <sourceUrl>`

> **Note:** Expense-level source URL attribution is not yet implemented — each expense's `notes` field is imported as-is from the source without an appended attribution.
