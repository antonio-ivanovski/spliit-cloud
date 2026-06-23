## ADDED Requirements

### Requirement: Unlinked participants have no access
The system SHALL distinguish authenticated group members from unlinked LedgerParticipants and SHALL NOT grant group access to unlinked participants.

#### Scenario: Unlinked participant exists
- **WHEN** an imported group contains an unlinked participant entry
- **THEN** that entry can appear in expenses and balances but cannot sign in or access the group

### Requirement: Admin mapping correction
The system SHALL allow group owners or admins to correct participant mappings when needed.

#### Scenario: Admin maps unlinked participant
- **WHEN** an owner or admin maps an unlinked participant entry to an account
- **THEN** the system links the LedgerParticipant to that account and creates or activates group membership if needed
