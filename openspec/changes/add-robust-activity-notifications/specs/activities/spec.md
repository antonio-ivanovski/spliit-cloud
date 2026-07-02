## MODIFIED Requirements

### Requirement: Ledger activity actors
The system SHALL record activity against the Ledger and SHALL represent activity actors through generic typed actor fields rather than event-specific foreign-key columns.

#### Scenario: Expense created
- **WHEN** an authenticated member creates an expense
- **THEN** the system records Ledger activity with actor type ACCOUNT and the actor account identifier

#### Scenario: Direct ledger future compatibility
- **WHEN** a non-group Ledger records an activity
- **THEN** the activity model does not require a group ID

#### Scenario: Actor display survives missing ledger participant
- **WHEN** a recorded activity has an authenticated account actor but no resolvable ledger participant actor
- **THEN** the system preserves the account actor identity in generic actor fields and renders a safe fallback actor label

## ADDED Requirements

### Requirement: Typed activity payloads
The system SHALL store activity detail payloads as nullable typed JSON validated by a shared Zod discriminated union.

#### Scenario: Persist typed expense activity payload
- **WHEN** an expense activity is recorded
- **THEN** the activity JSON payload conforms to the shared expense activity schema

#### Scenario: Persist typed group activity payload
- **WHEN** a group settings or archive activity is recorded
- **THEN** the activity JSON payload conforms to the shared group activity schema

#### Scenario: Persist typed member activity payload
- **WHEN** a member lifecycle or role activity is recorded
- **THEN** the activity JSON payload conforms to the shared member activity schema

#### Scenario: Persist typed invitation activity payload
- **WHEN** an invitation lifecycle activity is recorded
- **THEN** the activity JSON payload conforms to the shared invitation activity schema

#### Scenario: Legacy nullable payload
- **WHEN** an existing activity row has no JSON payload
- **THEN** the system still returns and renders the activity using a safe fallback

### Requirement: Expanded activity event taxonomy
The system SHALL use code-defined, Zod-validated string activity types for expense, group, invitation, and member lifecycle events, SHALL type the Prisma string field from an externally provided type inferred from the same Zod schema, and SHALL NOT require a Prisma or database enum for activity type values.

#### Scenario: Prisma string field is typed
- **WHEN** Prisma Client reads or writes Activity rows
- **THEN** the `type` field is typed as the shared activity type union inferred from the domain Zod schema rather than as an unrestricted string

### Requirement: Generic activity subject fields
The system SHALL represent event subjects through generic typed subject fields rather than event-specific foreign-key columns.

#### Scenario: Expense subject
- **WHEN** expense create, update, or delete activity is recorded
- **THEN** the activity subject type is EXPENSE and the subject identifier is the expense identifier when available

#### Scenario: Invitation subject
- **WHEN** invitation lifecycle activity is recorded
- **THEN** the activity subject type is INVITATION and the subject identifier is the invitation identifier when available

#### Scenario: Member subject
- **WHEN** member lifecycle or role activity is recorded
- **THEN** the activity subject type is MEMBER and the subject identifier is the group member identifier when available

#### Scenario: Group subject
- **WHEN** group settings or archive activity is recorded
- **THEN** the activity subject type is GROUP and the subject identifier is the group identifier when available

### Requirement: Generic activity schema migration
The system SHALL migrate Activity rows to a generic event-log schema and SHALL remove specialized activity columns for account, ledger participant, and expense references.

#### Scenario: Existing actor columns migrated
- **WHEN** an existing activity row has account or ledger participant actor columns
- **THEN** the migration preserves the best available actor identity in generic actor fields or typed payload metadata

#### Scenario: Existing expense column migrated
- **WHEN** an existing activity row has an expense identifier
- **THEN** the migration preserves that identifier as generic EXPENSE subject data

#### Scenario: Specialized columns removed
- **WHEN** the activity migration is complete
- **THEN** the Activity table no longer contains event-specific `accountId`, `ledgerParticipantId`, or `expenseId` columns

#### Scenario: Expense event names
- **WHEN** expense create, update, or delete activity is recorded
- **THEN** the activity type is EXPENSE_CREATED, EXPENSE_UPDATED, or EXPENSE_DELETED respectively

#### Scenario: Group event names
- **WHEN** group settings are updated or group archive state changes
- **THEN** the activity type is GROUP_UPDATED, GROUP_ARCHIVED, or GROUP_UNARCHIVED respectively

#### Scenario: Invitation event names
- **WHEN** an invitation is created, revoked, accepted, or declined
- **THEN** the activity type is INVITATION_CREATED, INVITATION_REVOKED, INVITATION_ACCEPTED, or INVITATION_DECLINED respectively

#### Scenario: Member event names
- **WHEN** a member leaves, is removed, or has their role changed
- **THEN** the activity type is MEMBER_LEFT, MEMBER_REMOVED, or MEMBER_ROLE_CHANGED respectively

### Requirement: Lightweight activity rendering
The system SHALL render activity as a friendly user-facing timeline using event type and typed payload data.

#### Scenario: Render changed expense fields
- **WHEN** an expense update activity has changed field names in its payload
- **THEN** the activity feed renders a lightweight summary of those changed fields

#### Scenario: Render invitation display label
- **WHEN** an invitation activity has a temporary name or display label
- **THEN** the activity feed uses that label instead of raw internal identifiers

#### Scenario: Fallback on invalid payload
- **WHEN** an activity payload is missing or fails schema validation
- **THEN** the activity feed renders a generic safe message rather than failing the page

### Requirement: Activity data migration
The system SHALL migrate existing activity rows to the new string activity type names and JSON payload shape pragmatically.

#### Scenario: Existing expense activity migrated
- **WHEN** an existing CREATE_EXPENSE, UPDATE_EXPENSE, or DELETE_EXPENSE row is migrated
- **THEN** the activity type string is renamed to the corresponding EXPENSE_CREATED, EXPENSE_UPDATED, or EXPENSE_DELETED value and any existing string data is preserved as lightweight expense title or summary metadata where practical

#### Scenario: Existing group activity migrated
- **WHEN** an existing UPDATE_GROUP row is migrated
- **THEN** the activity type string is renamed to GROUP_UPDATED and existing string data is either represented in JSON summary metadata or left null when no useful safe mapping exists
