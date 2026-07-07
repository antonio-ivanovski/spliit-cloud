## ADDED Requirements

### Requirement: Friends list
The system SHALL provide an `account.friends` query that returns the authenticated account's friends — accounts the user has shared group memberships with. The list SHALL be computed on the fly from shared group memberships (not stored as a separate contact entity). The system SHALL enrich each friend with metadata indicating whether a friend ledger already exists between the caller and that account.

#### Scenario: Query returns friends from shared groups
- **WHEN** an authenticated account queries `account.friends`
- **THEN** the system returns accounts that share any group membership (ACTIVE, LEFT, or REMOVED) with the caller, ordered by shared group count descending
- **AND** the system excludes accounts whose email is a synthetic placeholder

#### Scenario: Friend list enriched with friend-ledger metadata
- **WHEN** an authenticated account queries `account.friends`
- **THEN** each friend entry SHALL include a flag indicating whether a FRIEND-typed group with a matching `friendPairKey` (or pending `FRIEND` email invitation) already exists between the caller and that account

### Requirement: Per-account group preferences
The system SHALL store per-account group preferences in `AccountGroupPreference` with two boolean columns: `starred` and `hidden`. The `starred` column backs the "Starred" homepage section. The `hidden` column backs the per-account "hide" preference (removing the group from the account's default homepage view). The system SHALL NOT maintain a `pinned` or per-account `archived` column.

#### Scenario: account.groups returns preference with starred and hidden
- **WHEN** the system processes the `account.groups` query
- **THEN** each group SHALL include a `preference` object with `starred` (boolean) and `hidden` (boolean)
- **AND** the `preference` object SHALL NOT include a `pinned` field

#### Scenario: setPreference accepts starred and hidden
- **WHEN** an authenticated account calls `account.setPreference`
- **THEN** the input SHALL accept `starred` (optional boolean) and `hidden` (optional boolean)
- **AND** the input SHALL NOT accept a `pinned` field

#### Scenario: Migration merges archived into hidden
- **WHEN** the migration runs
- **THEN** the system SHALL merge the per-account `archived` column into `hidden` via `hidden = hidden OR archived`
- **AND** the system SHALL drop the `archived` column
- **AND** the system SHALL drop the dormant `pinned` column (which is always `false` and never read or toggled)

## REMOVED Requirements

### Requirement: Contacts query
**Reason**: Renamed to `account.friends` for vocabulary consistency with the new friend ledger feature. The semantics are unchanged — the list is still computed on the fly from shared group memberships.
**Migration**: Use `account.friends` instead of `account.contacts`. The response shape is extended with friend-ledger metadata but the core fields (accountId, name, email, sharedGroupCount) are unchanged.
