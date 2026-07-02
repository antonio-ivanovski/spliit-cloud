## MODIFIED Requirements

### Requirement: Ledger activity actors
The system SHALL record activity against the Ledger and SHALL associate activity actors with authenticated accounts or member-backed ledger participants where applicable.

#### Scenario: Expense created
- **WHEN** an authenticated member creates an expense
- **THEN** the system records Ledger activity with that actor

#### Scenario: Direct ledger future compatibility
- **WHEN** a non-group Ledger records an activity
- **THEN** the activity model does not require a group ID

#### Scenario: Actor display survives missing ledger participant
- **WHEN** a recorded activity has an authenticated account actor but no resolvable ledger participant actor
- **THEN** the system preserves the account actor association and renders a safe fallback actor label

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
The system SHALL use first-class activity types for expense, group, invitation, and member lifecycle events.

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
The system SHALL migrate existing activity rows to the new activity event names and JSON payload shape pragmatically.

#### Scenario: Existing expense activity migrated
- **WHEN** an existing CREATE_EXPENSE, UPDATE_EXPENSE, or DELETE_EXPENSE row is migrated
- **THEN** the activity type is renamed to the corresponding EXPENSE_CREATED, EXPENSE_UPDATED, or EXPENSE_DELETED value and any existing string data is preserved as lightweight expense title or summary metadata where practical

#### Scenario: Existing group activity migrated
- **WHEN** an existing UPDATE_GROUP row is migrated
- **THEN** the activity type is renamed to GROUP_UPDATED and existing string data is either represented in JSON summary metadata or left null when no useful safe mapping exists
