## ADDED Requirements

### Requirement: Membership-authorized exports
The system SHALL authorize exports by authenticated account access to the requested Ledger.

#### Scenario: Member exports group ledger
- **WHEN** an authenticated group member requests an export for the group Ledger
- **THEN** the system returns the export

#### Scenario: Non-member exports group ledger
- **WHEN** a non-member requests an export for the group Ledger
- **THEN** the system rejects the request
