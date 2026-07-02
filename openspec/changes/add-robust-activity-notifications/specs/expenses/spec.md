## ADDED Requirements

### Requirement: Expense activity recording
The system SHALL record structured activity for expense create, update, and delete mutations.

#### Scenario: Create expense activity
- **WHEN** an authenticated active group member creates an expense
- **THEN** the system records EXPENSE_CREATED activity with actor identity, expense identity, and lightweight expense metadata

#### Scenario: Update expense activity
- **WHEN** an authenticated active group member updates an expense
- **THEN** the system records EXPENSE_UPDATED activity with actor identity, expense identity, lightweight expense metadata, and changed field names

#### Scenario: Delete expense activity
- **WHEN** an authenticated active group member deletes an expense
- **THEN** the system records EXPENSE_DELETED activity with actor identity, expense identity, and lightweight metadata from the deleted expense

#### Scenario: Activity committed atomically
- **WHEN** an expense create, update, or delete mutation is committed
- **THEN** the expense data change and its activity row are committed together

### Requirement: Expense changed-field summary
The system SHALL compute a lightweight changed-field summary for expense updates without requiring exact per-recipient value deltas.

#### Scenario: Amount changed
- **WHEN** an expense update changes amount or currency metadata
- **THEN** the changed field summary includes amount

#### Scenario: Split changed
- **WHEN** an expense update changes paid-for, paid-by, item paid-for, itemized remainder, or split mode data
- **THEN** the changed field summary includes split or payers as appropriate

#### Scenario: Documents changed
- **WHEN** an expense update adds or removes expense documents
- **THEN** the changed field summary includes documents

#### Scenario: Itemized data changed
- **WHEN** an expense update changes itemized expense rows
- **THEN** the changed field summary includes items

#### Scenario: Simple metadata changed
- **WHEN** an expense update changes title, date, category, notes, or recurrence
- **THEN** the changed field summary includes the corresponding field names

### Requirement: Expense affected participant set
The system SHALL determine affected expense participants from the union of old and new payer and split references.

#### Scenario: Create affected participants
- **WHEN** an expense is created
- **THEN** affected participants are all participants referenced by the created expense's paid-by, paid-for, item paid-for, and itemized remainder data

#### Scenario: Update affected participants
- **WHEN** an expense is updated
- **THEN** affected participants are all participants referenced by either the previous expense state or the updated expense state

#### Scenario: Delete affected participants
- **WHEN** an expense is deleted
- **THEN** affected participants are all participants referenced by the deleted expense's paid-by, paid-for, item paid-for, and itemized remainder data

#### Scenario: Removed from expense but still active
- **WHEN** an active member was referenced by the previous expense state but not by the updated expense state
- **THEN** that member remains part of the affected participant set for the update
