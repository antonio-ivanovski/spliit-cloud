## ADDED Requirements

### Requirement: Email-based account authentication
The system SHALL allow users to authenticate using magic link, Google OAuth, or email plus password. Username-only password authentication MUST NOT be supported.

#### Scenario: Sign in with email and password
- **WHEN** a user submits a registered email address and valid password
- **THEN** the system authenticates the matching account and creates a session

#### Scenario: Reject username-only login
- **WHEN** a user attempts to sign in without an email address
- **THEN** the system rejects the authentication attempt

### Requirement: Email identity merging
The system SHALL merge authentication identities into one account when the identities have the same verified email address.

#### Scenario: Google sign-in matches password account
- **WHEN** a user signs in with Google using an email that already belongs to an email/password account
- **THEN** the system links the Google identity to the existing account

#### Scenario: Magic link matches existing account
- **WHEN** a user signs in with a magic link for an email that already belongs to an account
- **THEN** the system authenticates the existing account instead of creating a duplicate account

### Requirement: Authenticated sessions
The system SHALL issue server-recognized sessions to authenticated users and SHALL expose the authenticated account in API context.

#### Scenario: Protected procedure with valid session
- **WHEN** a request includes a valid session
- **THEN** protected procedures receive the authenticated account in context

#### Scenario: Protected procedure without valid session
- **WHEN** a request has no valid session
- **THEN** protected procedures reject the request as unauthenticated

### Requirement: Invite-only account registration
The system SHALL support a `SIGNUP_MODE` of `open` or `invite_only`. `open` SHALL remain the default. When `invite_only` is set, the system SHALL allow account creation only for the first account on the instance, an email that matches a pending group or friend email invitation, or a request that presents a live share-link invite token. Existing accounts SHALL still be able to sign in.

#### Scenario: Open registration remains the default
- **WHEN** `SIGNUP_MODE` is unset or `open`
- **THEN** a visitor can create an account without an invitation

#### Scenario: First user bootstraps an invite-only instance
- **WHEN** `SIGNUP_MODE` is `invite_only` and the instance has no accounts
- **THEN** the visitor can create the first account

#### Scenario: Pending email invitation unlocks sign-up
- **WHEN** `SIGNUP_MODE` is `invite_only` and a pending EMAIL group or friend invitation exists for an address
- **THEN** a visitor can create an account with that email

#### Scenario: Live share-link invite unlocks sign-up
- **WHEN** `SIGNUP_MODE` is `invite_only` and the request includes a usable link-invite token
- **THEN** a visitor can create an account

#### Scenario: Uninvited sign-up is rejected
- **WHEN** `SIGNUP_MODE` is `invite_only`, at least one account exists, and the visitor has no pending email invitation and no usable link-invite token
- **THEN** the system rejects account creation with `SIGNUP_INVITE_REQUIRED`
