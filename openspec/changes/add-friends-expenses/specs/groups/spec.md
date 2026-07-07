## MODIFIED Requirements

### Requirement: Account-owned cloud groups
The system SHALL create groups as cloud resources owned and accessed through authenticated account membership. The system SHALL discriminate between regular groups (`GROUP` type) and friend ledgers (`FRIEND` type) via a `groupType` column on the `Group` model. Existing groups SHALL backfill to `GROUP`.

#### Scenario: Authenticated group creation
- **WHEN** an authenticated account creates a regular group
- **THEN** the system creates the group with `groupType = GROUP` and makes the account an OWNER member

#### Scenario: Authenticated friend ledger creation
- **WHEN** an authenticated account creates a friend ledger
- **THEN** the system creates the group with `groupType = FRIEND` and the name set to an empty string

#### Scenario: Unauthenticated group creation
- **WHEN** an unauthenticated request attempts to create a group
- **THEN** the system rejects the request

#### Scenario: Existing groups backfill to GROUP type
- **WHEN** the migration adds the `groupType` column
- **THEN** all existing groups SHALL have `groupType = GROUP` via the column default

## ADDED Requirements

### Requirement: Group type discriminator
The system SHALL expose `groupType` on all group-related API responses. The `account.groups` query SHALL return `groupType` and a per-viewer `displayName` for each group. The `displayName` for `GROUP`-typed groups SHALL equal `Group.name`; the `displayName` for `FRIEND`-typed groups SHALL be the other member's resolved display name.

#### Scenario: account.groups returns groupType and displayName
- **WHEN** the system processes the `account.groups` query
- **THEN** each returned group SHALL include `groupType` (`GROUP` or `FRIEND`)
- **AND** each returned group SHALL include a `displayName` field

#### Scenario: GROUP-typed group displayName
- **WHEN** a `GROUP`-typed group is returned by `account.groups`
- **THEN** the `displayName` SHALL equal `Group.name`

#### Scenario: FRIEND-typed group displayName
- **WHEN** a `FRIEND`-typed group is returned by `account.groups`
- **THEN** the `displayName` SHALL be the other member's display name resolved via `resolveParticipantDisplayName`
