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

- **WHEN** an imported expense has original currency and conversion data in the source export
- **THEN** the system stores the Ledger-currency amount and preserves the original conversion fields

#### Scenario: Cross-currency import auto-fills original fields

- **WHEN** the source group's currency code differs from the destination ledger's currency code
- **THEN** each imported expense has `originalAmount` set to the source `amount`, `originalCurrency` set to the source currency code, and `conversionRate` set to `1` regardless of whether the source export carried conversion data

#### Scenario: Same-currency import passes original fields through

- **WHEN** the source and destination currency codes match
- **THEN** the imported expenses preserve any `originalAmount`, `originalCurrency`, and `conversionRate` from the source export; absent fields remain absent
