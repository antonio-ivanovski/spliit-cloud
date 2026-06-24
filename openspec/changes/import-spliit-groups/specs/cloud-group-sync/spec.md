## ADDED Requirements

### Requirement: Imported groups become server-backed groups

The system SHALL create imported groups as normal server-backed cloud groups with Ledgers and membership authorization.

#### Scenario: Import completed

- **WHEN** an import commits successfully
- **THEN** the destination group appears as a membership-backed group for authorized accounts

#### Scenario: Non-member access

- **WHEN** an account without membership attempts to access the imported group
- **THEN** the system denies access
