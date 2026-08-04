## Purpose

Defines group lifecycle and settings requirements: cloud group ownership, friend ledger discrimination, creation UI, and ledger base currency selection — including supported fiat and crypto catalog codes.

## Requirements

### Requirement: Account-owned cloud groups
The system SHALL create groups as cloud resources owned and accessed through authenticated account membership. The system SHALL discriminate between regular groups (`GROUP` type) and friend ledgers (`FRIEND` type) via a `groupType` column on the `Group` model. Existing groups SHALL backfill to `GROUP`.

#### Scenario: Authenticated group creation
- **WHEN** an authenticated account creates a regular group
- **THEN** the system creates the group with `groupType = GROUP` and makes the account an OWNER member

#### Scenario: Authenticated friend ledger creation
- **WHEN** an authenticated account creates a friend ledger (via `friends.create`, not `groups.create`)
- **THEN** the system creates the group with `groupType = FRIEND` and the name set to a `randomId()` value (a namespace filler; never shown to users)
- **AND** the `friends.create` procedure SHALL be the sole way to create FRIEND-typed groups; `groups.create` SHALL always create `GROUP`-typed groups and SHALL NOT accept a `groupType` input

#### Scenario: Unauthenticated group creation
- **WHEN** an unauthenticated request attempts to create a group
- **THEN** the system rejects the request

#### Scenario: Existing groups backfill to GROUP type
- **WHEN** the migration adds the `groupType` column
- **THEN** all existing groups SHALL have `groupType = GROUP` via the column default

### Requirement: Group type discriminator
The system SHALL expose `groupType` on all group-related API responses. The `account.groups` query SHALL return `groupType` and a per-viewer `displayName` for each group. The `displayName` for `GROUP`-typed groups SHALL equal `Group.name`; the `displayName` for `FRIEND`-typed groups SHALL be the other member's resolved display name.

#### Scenario: account.groups returns enriched group data
- **WHEN** the system processes the `account.groups` query
- **THEN** each returned group SHALL include `groupType` (`GROUP` or `FRIEND`)
- **AND** each returned group SHALL include a `displayName` field
- **AND** each returned group SHALL include a `currentMemberRole` field (the role of the calling account in that group)
- **AND** each returned group SHALL include a `preference` object with `starred` (boolean) and `hidden` (boolean) — see account-profiles spec
- **AND** each returned group SHALL include `_count.members` (the total count of ACTIVE members)

#### Scenario: GROUP-typed group displayName
- **WHEN** a `GROUP`-typed group is returned by `account.groups`
- **THEN** the `displayName` SHALL equal `Group.name`

#### Scenario: FRIEND-typed group displayName
- **WHEN** a `FRIEND`-typed group is returned by `account.groups`
- **THEN** the `displayName` SHALL be the other member's display name resolved via `resolveParticipantDisplayName`

### Requirement: Group creation page layout
The system SHALL display a consistent group creation page with a navigation heading and a form for creating the group.

#### Scenario: Create group page shows heading and back button
- **WHEN** an authenticated account navigates to the create group page
- **THEN** the page SHALL display a back arrow button (top-left) and a title heading "Create a group"
- **AND** the page SHALL require authentication (redirects to sign-in for unauthenticated visitors)
- **AND** the page SHALL render the group form component below the heading

### Requirement: Group form name field visibility by group type
The system SHALL conditionally show or hide the group name field in the group settings form based on the group's type. For `FRIEND`-typed groups, the name field SHALL be fully omitted (not rendered) because the `Group.name` is a random-id filler never displayed to users.

#### Scenario: GROUP-typed group shows name field
- **WHEN** the group settings form is rendered for a `GROUP`-typed group
- **THEN** the form SHALL include an editable group name input field

#### Scenario: FRIEND-typed group hides name field
- **WHEN** the group settings form is rendered for a `FRIEND`-typed group
- **THEN** the form SHALL NOT include a group name input field (it is hidden, not merely disabled or read-only)

### Requirement: Immutable group currency after expenses
The system SHALL reject changes to a group Ledger base currency after the Ledger contains expenses.

#### Scenario: Change currency before expenses
- **WHEN** a group Ledger has no expenses
- **THEN** the owner may change the Ledger base currency through the group update flow (supported catalog fiat or crypto code, or custom currency)

#### Scenario: Change currency after expenses
- **WHEN** a group Ledger has one or more expenses
- **THEN** the system rejects attempts to change the Ledger base currency and preserves the existing currency

### Requirement: Group currency selection
The system SHALL allow supported catalog currency codes (ISO fiat and crypto tickers of length 3–4) and custom currencies for new and updated group currencies, subject to the immutable-after-expenses rule. Custom base currencies SHALL not use automatic exchange-provider conversion for expenses; converted expenses against a custom base require custom rates.

#### Scenario: Create group with fiat currency
- **WHEN** a user creates a group with a supported fiat code such as `EUR`
- **THEN** the system stores that code as the Ledger base currency

#### Scenario: Create group with crypto currency
- **WHEN** a user creates a group with a supported crypto code such as `BTC`
- **THEN** the system stores that code as the Ledger base currency and allows expenses in other catalog currencies with EXCHANGE or CUSTOM conversion

#### Scenario: Create group with custom currency
- **WHEN** a user creates a group with a custom currency (empty `currencyCode`)
- **THEN** the system stores the custom currency representation and allows later expenses in catalog currencies with `conversionSource` `CUSTOM` when currencies differ
