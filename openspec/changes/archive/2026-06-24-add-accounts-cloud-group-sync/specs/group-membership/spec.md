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

The system SHALL support group roles for OWNER, ADMIN, and MEMBER. Invitations SHALL only be sent to ADMIN or MEMBER roles; the OWNER role is reserved for the group creator and is not assignable through an invitation.

#### Scenario: Owner manages group

- **WHEN** an OWNER updates group settings or manages members
- **THEN** the system allows the operation

#### Scenario: Admin manages invitations

- **WHEN** an ADMIN invites or revokes a member
- **THEN** the system allows the operation

#### Scenario: Member manages restricted settings

- **WHEN** a MEMBER attempts an owner/admin-only operation
- **THEN** the system rejects the operation

#### Scenario: Member cannot invite

- **WHEN** a MEMBER attempts to create an invitation
- **THEN** the system rejects the request

### Requirement: Email invitations

The system SHALL support group invitations by email and SHALL accept invitations only for matching authenticated email identities unless an owner or admin changes the invite.

#### Scenario: Invited email accepts

- **WHEN** a user authenticates with the invited email and accepts the invitation
- **THEN** the system creates or activates group membership for that account

#### Scenario: Different email attempts acceptance

- **WHEN** a user authenticates with a different email than the invitation target
- **THEN** the system does not automatically accept the invitation

#### Scenario: Cannot invite yourself

- **WHEN** an OWNER or ADMIN tries to invite an email that matches their own account email
- **THEN** the system rejects the request

#### Scenario: Cannot invite an existing member

- **WHEN** an OWNER or ADMIN tries to invite an email that already has an ACCEPTED membership in the group
- **THEN** the system rejects the request

### Requirement: Invitation lifecycle

The system SHALL support a lifecycle of `PENDING`, `ACCEPTED`, `REVOKED`, and `DECLINED` for invitations, and SHALL prevent more than one PENDING invitation from existing for the same `(group, email)` pair at a time.

#### Scenario: Duplicate pending invitation rejected

- **WHEN** an OWNER or ADMIN tries to create a second PENDING invitation for the same group and email
- **THEN** the system rejects the request and the user is told to revoke the existing pending invitation first

#### Scenario: Invitee can decline

- **WHEN** an authenticated user declines their own pending invitation
- **THEN** the system marks the invitation as DECLINED and the user is not added to the group

### Requirement: Pending invitations are visible to the invitee

The system SHALL list pending invitations addressed to the current account in a dedicated surface so the invitee can review and respond.

#### Scenario: Invitee sees pending invitations

- **WHEN** an authenticated account has one or more PENDING invitations addressed to their email
- **THEN** the system surfaces those invitations with Accept and Decline actions

### Requirement: Invited emails are usable as expense parties

The system SHALL materialise a `LedgerParticipant` for each PENDING invitation so that invited email addresses can be selected as payer or paid-for in expense forms, even before the invitee accepts.

#### Scenario: Invited email appears in expense form

- **WHEN** a member creates an expense for a group that has a PENDING invitation
- **THEN** the invited email appears in the payer and paid-for selectors
