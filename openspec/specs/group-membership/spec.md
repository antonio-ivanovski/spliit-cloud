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
