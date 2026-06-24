## ADDED Requirements

### Requirement: Imported expenses preserve source participants

The system SHALL import expenses so paid-by and paid-for rows reference destination LedgerParticipants that correspond to source participants.

#### Scenario: Imported expense with unlinked participant

- **WHEN** an imported expense references a source participant mapped as unlinked
- **THEN** the destination expense references the unlinked LedgerParticipant

### Requirement: Imported expenses remain editable

The system SHALL allow imported expenses to be edited using the same edit behavior as normal group expenses, including expenses involving unlinked participant entries.

#### Scenario: Edit imported split

- **WHEN** a user edits an imported expense split involving an unlinked participant
- **THEN** the system saves the updated split against the destination LedgerParticipants

### Requirement: Imported currency preservation

The system SHALL normalize imported expense amounts to the destination Ledger base currency and SHALL preserve original amount, original currency, and conversion rate when available.

#### Scenario: Imported converted expense

- **WHEN** an imported expense has original currency and conversion data
- **THEN** the system stores the Ledger-currency amount and preserves original conversion fields
