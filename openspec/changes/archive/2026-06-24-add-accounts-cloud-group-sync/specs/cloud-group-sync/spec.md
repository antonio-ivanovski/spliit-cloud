## ADDED Requirements

### Requirement: Server source of truth

The system SHALL treat server data as the source of truth for account-backed groups, memberships, ledgers, expenses, balances, activities, documents, and settings.

#### Scenario: Group list

- **WHEN** an authenticated user views their groups
- **THEN** the system returns groups from server-side membership state

#### Scenario: Browser-local group state exists

- **WHEN** browser-local recent or active participant state exists
- **THEN** the system does not use it to grant access or determine active account identity

### Requirement: Cross-device account state

The system SHALL store account group preferences and membership state on the server so they are available across sessions and devices.

#### Scenario: Starred group on another device

- **WHEN** a user marks a group preference on one device
- **THEN** the server-backed preference is available when the user signs in on another device
