## ADDED Requirements

### Requirement: Account-owned cloud groups

The system SHALL create groups as cloud resources owned and accessed through authenticated account membership.

#### Scenario: Authenticated group creation

- **WHEN** an authenticated account creates a group
- **THEN** the system creates the group and an associated Ledger, and makes the account an OWNER member

#### Scenario: Unauthenticated group creation

- **WHEN** an unauthenticated request attempts to create a group
- **THEN** the system rejects the request

### Requirement: Group-level archive

The system SHALL expose a group-level `archived` flag. Only OWNER and ADMIN members SHALL be able to change the flag. Archiving a group freezes new expenses and expense edits, and the flag applies to every member of the group.

#### Scenario: Owner archives a group

- **WHEN** an OWNER or ADMIN sets the group archive flag to `true`
- **THEN** the system records the change and applies it to every member of the group

#### Scenario: Member cannot archive

- **WHEN** a MEMBER attempts to set the group archive flag
- **THEN** the system rejects the request

#### Scenario: Archived group blocks new expenses

- **WHEN** a user attempts to create or edit an expense on an archived group
- **THEN** the system rejects the request

#### Scenario: Archived group allows viewing

- **WHEN** a member opens an archived group
- **THEN** the system renders the group's expenses, balances, activity, and information in read-only form

### Requirement: Per-account hide

The system SHALL allow every account to hide individual groups from their own group list via a per-account preference. Hiding affects only the owning account and SHALL be independent from the group-level archive flag.

#### Scenario: Hidden group does not appear

- **WHEN** an account sets the "hide" preference for a group
- **THEN** the group no longer appears in the account's default group list

#### Scenario: Hidden group is still accessible by direct URL

- **WHEN** an account navigates directly to a group they have hidden
- **THEN** the system still grants access because the user remains a member

### Requirement: Archive with unsettled balances

The system SHALL require the ledger to be settled before a group can be archived, unless the caller explicitly forces the archive. Forcing an archive SHALL create one reimbursement-style "Settlement on archive" expense per non-zero leg inside the same transaction as the archive flip, so the new `archived` state matches a zeroed-out ledger.

#### Scenario: Archive with unsettled balances

- **WHEN** an OWNER or ADMIN archives a group whose ledger has non-zero balances
- **THEN** the system rejects the request unless `force: true` is supplied

#### Scenario: Force-archive creates settlement expenses

- **WHEN** an OWNER or ADMIN force-archives a group with non-zero balances
- **THEN** the system creates one "Settlement on archive" reimbursement per non-zero leg, then flips the group to archived, all in a single transaction

#### Scenario: Archive with zero balances

- **WHEN** an OWNER or ADMIN archives a group whose ledger balances are already zero
- **THEN** the system archives the group without creating any settlement expenses
