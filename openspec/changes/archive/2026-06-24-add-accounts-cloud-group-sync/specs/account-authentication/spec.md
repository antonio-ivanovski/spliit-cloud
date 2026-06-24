## ADDED Requirements

### Requirement: Email-based account authentication

The system SHALL allow users to authenticate using magic link, Google OAuth, or email plus password. Username-only password authentication MUST NOT be supported.

#### Scenario: Sign in with email and password

- **WHEN** a user submits a registered email address and valid password
- **THEN** the system authenticates the matching account and creates a session

#### Scenario: Sign up with email and password

- **WHEN** a user submits a new email address and a password of at least 8 characters
- **THEN** the system creates a new account, issues a verification email, and only finalises sign-in once the email address is verified

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

### Requirement: Magic-link delivery without SMTP

The system SHALL always allow sign-in via magic link regardless of whether an SMTP server is configured; when SMTP is unavailable the message SHALL be written to a local development mailbox so the recipient can still complete the flow in development.

#### Scenario: Magic link in production with SMTP

- **WHEN** SMTP credentials are configured and a user requests a magic link
- **THEN** the system delivers the link to the recipient's email address

#### Scenario: Magic link in local development

- **WHEN** SMTP is not configured and a user requests a magic link
- **THEN** the system writes the message to a local `.mail/` directory and the developer can copy the link from there

### Requirement: First-login display-name capture

The system SHALL require an authenticated account to have a non-empty display name. Magic-link sign-ups that do not supply a display name during sign-in SHALL be redirected to a profile-completion surface on their first authenticated visit.

#### Scenario: Magic-link first sign-in

- **WHEN** a user signs in via magic link and the resulting account has no display name
- **THEN** the system routes them to a "complete your profile" page before they can access protected routes

#### Scenario: Email-password first sign-in

- **WHEN** a user signs up with email and password and the account has no display name
- **THEN** the system routes them to a "complete your profile" page on their first protected-route visit
