## ADDED Requirements

### Requirement: Cross-Device Group Sync

The system SHALL allow users to sync their joined groups across devices using a sync provider.

#### Scenario: Connect Spliit Cloud for sync via magic link

- **WHEN** user navigates to sync settings and selects Spliit Cloud
- **AND** enters their email address
- **THEN** the system sends a magic link to that email
- **AND** displays "Check your email" message

#### Scenario: Complete magic link authentication

- **WHEN** user clicks magic link in email
- **THEN** the system creates or retrieves user account
- **AND** issues a session token stored in localStorage
- **AND** displays Spliit Cloud as connected

#### Scenario: Connect Spliit Cloud via OAuth

- **WHEN** user navigates to sync settings and selects Spliit Cloud
- **AND** chooses "Continue with Google" or "Continue with GitHub"
- **THEN** the system redirects to OAuth provider
- **AND** on callback, creates or retrieves user account linked to OAuth identity
- **AND** issues a session token stored in localStorage

#### Scenario: Push groups to Spliit Cloud

- **WHEN** user is authenticated with Spliit Cloud
- **AND** triggers manual sync or auto-sync runs
- **THEN** the system uploads current joined groups list to Spliit backend
- **AND** updates lastSyncAt timestamp

#### Scenario: Pull groups from Spliit Cloud

- **WHEN** user loads app on a new device
- **AND** authenticates with same Spliit Cloud account
- **THEN** the system downloads groups list from Spliit backend
- **AND** merges with any local groups (union)
- **AND** saves combined list to localStorage

#### Scenario: Disconnect sync provider

- **WHEN** user disconnects from Spliit Cloud
- **THEN** the system clears session token
- **AND** stops automatic sync
- **AND** local groups remain unchanged

#### Scenario: Delete Spliit Cloud account

- **WHEN** user requests account deletion
- **THEN** the system removes all synced data from Spliit backend
- **AND** disconnects the sync
- **AND** local groups remain unchanged

### Requirement: Sync Provider Extensibility

The system SHALL support multiple sync providers through a pluggable provider interface.

#### Scenario: List available providers

- **WHEN** user opens sync settings
- **THEN** the system displays all configured providers (Spliit Cloud as primary)
- **AND** indicates which providers have required credentials configured

#### Scenario: Provider unavailable without credentials

- **WHEN** a sync provider's required environment variables are not set
- **THEN** that provider is not offered to users
- **AND** documentation explains required configuration

#### Scenario: Future provider support

- **WHEN** self-hoster configures Google Drive credentials
- **THEN** Google Drive appears as additional sync option
- **AND** user can choose between Spliit Cloud or Google Drive

### Requirement: Spliit Cloud Authentication

The system SHALL provide lightweight authentication for Spliit Cloud sync.

#### Scenario: Magic link email delivery

- **WHEN** user requests magic link
- **THEN** the system generates a secure, time-limited token
- **AND** sends email with link containing the token
- **AND** token expires after 15 minutes

#### Scenario: Magic link token validation

- **WHEN** user clicks magic link
- **AND** token is valid and not expired
- **THEN** the system authenticates the user
- **AND** invalidates the token (single-use)

#### Scenario: Expired magic link

- **WHEN** user clicks magic link
- **AND** token has expired
- **THEN** the system displays "Link expired" message
- **AND** offers to send a new magic link

#### Scenario: OAuth identity linking

- **WHEN** user authenticates via OAuth (Google/GitHub)
- **AND** email matches existing magic-link account
- **THEN** the system links OAuth identity to existing account
- **AND** user can use either method to sign in

### Requirement: Sync Session Management

The system SHALL manage authentication sessions for sync.

#### Scenario: Session token refresh

- **WHEN** session token is near expiration
- **AND** user is actively using the app
- **THEN** the system silently refreshes the token

#### Scenario: Session expiration

- **WHEN** session token expires
- **AND** refresh fails
- **THEN** the system prompts user to re-authenticate
- **AND** local groups remain accessible

#### Scenario: Sign out from all devices

- **WHEN** user requests "Sign out everywhere"
- **THEN** the system invalidates all session tokens for that account
- **AND** other devices must re-authenticate on next sync attempt
