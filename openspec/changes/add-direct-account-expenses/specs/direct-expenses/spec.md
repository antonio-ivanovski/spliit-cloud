## ADDED Requirements

### Requirement: Direct ledgers between two accounts

The system SHALL support direct account-to-account expenses through a DIRECT Ledger that is visible as a direct relationship and not as a group.

#### Scenario: Create direct ledger with existing account

- **WHEN** an authenticated account starts a direct expense with another existing account
- **THEN** the system creates or reuses the unique DIRECT Ledger for the account pair

#### Scenario: Direct ledger not listed as group

- **WHEN** a user views their group list
- **THEN** direct ledgers do not appear as groups

### Requirement: Unique direct account pair

The system SHALL maintain at most one active DIRECT Ledger for an unordered pair of accounts.

#### Scenario: Second expense with same account

- **WHEN** a user creates another direct expense with the same account
- **THEN** the system uses the existing DIRECT Ledger for that pair

#### Scenario: Opposite account tries to create direct ledger

- **WHEN** the counterparty attempts to create a direct ledger with the original inviter after acceptance
- **THEN** the system navigates to the existing DIRECT Ledger instead of creating another one

### Requirement: Async invited direct expenses

The system SHALL allow a direct ledger to be created for an invited email and SHALL allow the inviter to record expenses before the invited email authenticates.

#### Scenario: Create pending direct expense

- **WHEN** an authenticated user creates a direct expense for an invited email
- **THEN** the system records the expense on a pending direct Ledger visible to the inviter

#### Scenario: Pending invite email privacy

- **WHEN** the system sends an invite for a pending direct Ledger
- **THEN** the invite email does not include direct expense details before authentication

#### Scenario: Change invited email before acceptance

- **WHEN** the inviter changes the invited email before the invite is accepted
- **THEN** the system updates the pending direct participant email

#### Scenario: Invited email accepts later

- **WHEN** the invited person authenticates with the matching email
- **THEN** the system links the pending direct participant to that account and shows existing direct expenses in that account's balances

### Requirement: Direct feature parity

Direct expenses SHALL support the same applicable expense features as group expenses, including split modes, reimbursements, notes, dates, categories, recurrence, documents, permanent editing, and activity.

#### Scenario: Recurring direct expense

- **WHEN** a user creates a recurring direct expense
- **THEN** the system stores recurrence data using the same Ledger expense recurrence semantics as groups

#### Scenario: Document on direct expense

- **WHEN** a user attaches a document to a direct expense
- **THEN** the system stores the document on the direct Ledger expense

### Requirement: No third participant

The system SHALL NOT allow a direct Ledger to add a third account or unlinked imported participant.

#### Scenario: Add third account

- **WHEN** a user attempts to add another account to an existing direct Ledger
- **THEN** the system rejects the operation

### Requirement: Direct exports

The system SHALL support direct relationship exports and account-wide exports that include direct Ledgers.

#### Scenario: Export direct relationship

- **WHEN** a participant exports a direct Ledger
- **THEN** the system returns export data for that direct relationship

#### Scenario: Account-wide export includes direct ledgers

- **WHEN** a user requests account-wide export
- **THEN** the export includes accessible group Ledgers and direct Ledgers
