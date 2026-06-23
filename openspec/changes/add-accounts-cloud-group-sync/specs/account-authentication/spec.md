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
