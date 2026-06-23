## ADDED Requirements

### Requirement: Membership-based group access
The system SHALL grant group access only to authenticated accounts that have group membership or a pending invitation that can be accepted.

#### Scenario: Member opens group
- **WHEN** an authenticated account with active membership opens a group
- **THEN** the system grants access to the group

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
