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

### Requirement: Admin role is preserved on reactivation

When an unlinked participant is linked to an account that was a prior member, the system SHALL preserve the account's previous role (ADMIN or MEMBER) rather than defaulting to MEMBER.

#### Scenario: Rejoining admin retains admin role

- **WHEN** an admin's membership is reactivated during the unlinked-participant link flow
- **THEN** the `GroupMember.role` is preserved (not demoted to MEMBER)
- **THEN** the admin retains their administrative privileges in the group

### Requirement: Source group note and URL attribution

The system SHALL compose an "Imported from:" attribution note using the `appendImportedFromNote` helper and pre-fill the destination group's information field with it.

#### Scenario: New group gets source URL attribution

- **WHEN** the user creates a new group from a Spliit URL import
- **THEN** the destination step pre-fills the group information text area with `Imported from: <sourceUrl>`

> **Note:** Expense-level source URL attribution is not yet implemented — each expense's `notes` field is imported as-is from the source without an appended attribution.
