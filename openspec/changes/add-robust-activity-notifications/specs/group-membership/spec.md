## MODIFIED Requirements

### Requirement: Membership-based group access
The system SHALL grant group access only to authenticated accounts that have active group membership or a pending invitation that can be accepted.

#### Scenario: Member opens group
- **WHEN** an authenticated account with active membership opens a group
- **THEN** the system grants access to the group

#### Scenario: Pending invitee opens group
- **WHEN** an authenticated account with a pending invitation opens a group
- **THEN** the system grants read-only access to the group including expenses, balances, stats, activities, and the information page
- **AND** the system SHALL reject any mutation: expense create/update/delete, group update/archive, invitation create/revoke/list
- **AND** the UI SHALL hide all edit affordances (create buttons, edit buttons, export, receipt upload) and SHALL surface an Accept/Decline banner

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

#### Scenario: Member leaves
- **WHEN** an active member leaves a group without deleting the group
- **THEN** the system records MEMBER_LEFT activity with actor identity and member display metadata

#### Scenario: Member removed
- **WHEN** an admin removes an active member from a group
- **THEN** the system records MEMBER_REMOVED activity with actor identity and removed member display metadata

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
The system SHALL record structured activity for group settings and group archive state changes.

#### Scenario: Group settings updated
- **WHEN** an admin updates group settings
- **THEN** the system records GROUP_UPDATED activity with actor identity and lightweight changed field metadata

#### Scenario: Group archived
- **WHEN** an admin archives a group
- **THEN** the system records GROUP_ARCHIVED activity with actor identity

#### Scenario: Group unarchived
- **WHEN** an admin unarchives a group
- **THEN** the system records GROUP_UNARCHIVED activity with actor identity
