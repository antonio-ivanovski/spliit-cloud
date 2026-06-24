## ADDED Requirements

### Requirement: Stable account profile
The system SHALL maintain a stable account profile with account ID, verified email, display name, and linked authentication identities.

#### Scenario: Account profile is created
- **WHEN** a user completes first authentication with a verified email
- **THEN** the system creates an account profile with a stable account ID

#### Scenario: Provider identity is linked
- **WHEN** an authenticated user adds another auth provider with the same verified email
- **THEN** the system links that provider to the existing account profile

### Requirement: Display name first identity
The system SHALL use display names as the primary visible identity and SHALL show email addresses only where needed for invite, account, or member-management context.

#### Scenario: Group expense display
- **WHEN** a group expense is displayed to members
- **THEN** the system shows participant display names as the primary identity

#### Scenario: Invite management display
- **WHEN** a group owner or admin manages invitations
- **THEN** the system may show email addresses needed to distinguish invitees
