## ADDED Requirements

### Requirement: Account-owned cloud groups
The system SHALL create groups as cloud resources owned and accessed through authenticated account membership.

#### Scenario: Authenticated group creation
- **WHEN** an authenticated account creates a group
- **THEN** the system creates the group and makes the account an OWNER member

#### Scenario: Unauthenticated group creation
- **WHEN** an unauthenticated request attempts to create a group
- **THEN** the system rejects the request
