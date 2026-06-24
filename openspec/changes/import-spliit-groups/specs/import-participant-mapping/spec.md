## ADDED Requirements

### Requirement: Participant mapping modes

The system SHALL let the importer map each source participant by name to an existing account, an unlinked participant entry, or skip the participant only when safe.

#### Scenario: Link existing account

- **WHEN** the importer maps a source participant to an existing account
- **THEN** the destination LedgerParticipant is account-backed

#### Scenario: Leave participant unlinked

- **WHEN** the importer maps a source participant as unlinked
- **THEN** the destination LedgerParticipant has a display name but no app access

### Requirement: No new unlinked participants after import

The system SHALL NOT allow users to create brand new unlinked participant entries after the import is committed.

#### Scenario: New expense with imported unlinked participant

- **WHEN** a user creates a new expense in an imported group
- **THEN** the user can select unlinked participant entries that were created during import

#### Scenario: Attempt create new unlinked participant

- **WHEN** a user attempts to add a new unlinked participant after import
- **THEN** the system rejects the operation

### Requirement: One-way participant linking

The system SHALL link an unlinked participant entry to an account as a one-way ownership migration only through an owner/admin mapping decision.

#### Scenario: Admin maps unlinked participant

- **WHEN** an owner or admin maps an unlinked LedgerParticipant to an account
- **THEN** the system migrates the unlinked LedgerParticipant to account ownership and creates or activates group membership if needed

#### Scenario: Linked balances appear

- **WHEN** an unlinked LedgerParticipant is linked to an account
- **THEN** historical and future balances for that LedgerParticipant are associated with the account
