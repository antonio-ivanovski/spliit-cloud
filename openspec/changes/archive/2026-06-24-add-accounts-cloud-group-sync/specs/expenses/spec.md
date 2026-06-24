## ADDED Requirements

### Requirement: Account-backed native group expenses

Native group expenses SHALL reference LedgerParticipants backed by authenticated group members.

#### Scenario: Native expense participant validation

- **WHEN** a native group expense references a payer or paid-for party
- **THEN** the referenced party is an active LedgerParticipant backed by group membership

#### Scenario: Removed member in history

- **WHEN** a member is removed after participating in an expense
- **THEN** the historical expense still references the LedgerParticipant for balance/history purposes
