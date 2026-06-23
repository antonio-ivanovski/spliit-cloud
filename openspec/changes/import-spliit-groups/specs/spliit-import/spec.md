## ADDED Requirements

### Requirement: Provider-neutral import architecture
The system SHALL implement imports through source adapters that normalize provider-specific data into a shared import model before validation, mapping, planning, and commit.

#### Scenario: Spliit source adapter
- **WHEN** a Spliit source adapter normalizes source data
- **THEN** shared import validation, mapping, planning, and commit services process the normalized records

#### Scenario: Future provider adapter
- **WHEN** a future provider such as Splitwise adds a source adapter
- **THEN** the provider can reuse shared import validation, mapping, planning, and commit services

### Requirement: Spliit import by URL or JSON
The system SHALL allow an authenticated user to import an existing Spliit group by providing a `spliit.app` group URL or uploaded exported JSON.

#### Scenario: Import by URL
- **WHEN** a user provides a supported `spliit.app` group URL
- **THEN** the system discovers and normalizes the source group data

#### Scenario: Import by JSON
- **WHEN** a user uploads supported exported JSON
- **THEN** the system parses and normalizes the source group data

### Requirement: Import wizard commit
The system SHALL run import as a wizard and SHALL create the destination group only during final transactional commit.

#### Scenario: Preview before commit
- **WHEN** source data has been normalized
- **THEN** the user can preview group, participant, expense, split, currency, document, and validation data before committing

#### Scenario: Commit import
- **WHEN** the user confirms import with valid mappings
- **THEN** the system transactionally creates the group, Ledger, participant entries, expenses, documents where supported, and import audit records

### Requirement: Duplicate import detection
The system SHALL detect duplicate imports using source provider, source identity, source adapter type, and normalized payload hash.

#### Scenario: Duplicate source import
- **WHEN** a user attempts to import a source group that was already imported with the same normalized payload
- **THEN** the system warns or blocks the duplicate according to import policy

### Requirement: Strict import validation
The system SHALL validate source participants, expenses, split modes, amounts, currencies, conversion data, documents, and mappings before commit.

#### Scenario: Missing participant mapping
- **WHEN** an imported expense references a participant without mapping
- **THEN** the system blocks final commit

#### Scenario: Unsupported document import
- **WHEN** a document cannot be copied or preserved
- **THEN** the system reports a validation issue or warning before final commit
