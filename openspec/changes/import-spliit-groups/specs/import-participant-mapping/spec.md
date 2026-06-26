## ADDED Requirements

### Requirement: Participant mapping modes in the wizard

The system SHALL let the importer map each source participant by name to an existing account, an unlinked participant entry, or skip the participant only when the source expenses no longer reference them.

#### Scenario: Link to an existing account

- **WHEN** the importer maps a source participant to an existing account
- **THEN** the destination `LedgerParticipant` is `ACCOUNT_MEMBER` and a `GroupMember` is created or reactivated if needed

#### Scenario: Leave participant unlinked

- **WHEN** the importer maps a source participant as unlinked
- **THEN** the destination `LedgerParticipant` is `UNLINKED_PARTICIPANT` with the source name as its `displayName` and no app access

#### Scenario: Skip a source participant

- **WHEN** the importer marks a source participant as `SKIP`
- **THEN** the destination group does not create a `LedgerParticipant` for that source identity
- **THEN** the web app drops that source identity from any `paidBy` / `paidFor` reference in the submitted expenses

### Requirement: One-way admin participant linking

The system SHALL let an owner or admin link an unlinked `LedgerParticipant` to an existing account as a one-way ownership migration. After the link, the historical and future balances of the `LedgerParticipant` are associated with the account and appear in account-level views.

#### Scenario: Admin maps an unlinked participant

- **WHEN** an owner or admin maps an unlinked `LedgerParticipant` to an account
- **THEN** the system migrates the `LedgerParticipant` to `ACCOUNT_MEMBER` and creates or activates the account's `GroupMember` if needed

#### Scenario: Linked balances surface in the account

- **WHEN** an unlinked `LedgerParticipant` is linked to an account
- **THEN** historical and future balances for that `LedgerParticipant` immediately contribute to the linked account's group and overview totals

### Requirement: Unlinked participants have no app access

The system SHALL distinguish authenticated group members from unlinked `LedgerParticipant` entries and SHALL NOT grant group access to unlinked participants.

#### Scenario: Unlinked participant exists

- **WHEN** an imported group contains an unlinked `LedgerParticipant` entry
- **THEN** that entry can appear in expenses and balances but cannot sign in or access the group

#### Scenario: Unlinked entry surfaces in the UI

- **WHEN** an unlinked `LedgerParticipant` appears in an expense card, a balance row, the expense form, or the admin link list
- **THEN** the UI labels it as unlinked so it is not confused with an app user
