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

### Requirement: Expense document S3 cleanup on deletion
The system SHALL clean up S3 objects for expense documents when an expense is deleted or an expense update removes documents.

#### Scenario: S3 cleanup after expense deletion
- **WHEN** an expense is deleted and the deleted expense has S3 document attachments
- **THEN** the system deletes each document's S3 object after the database transaction commits
- **AND** S3 cleanup failures are logged but do not prevent the expense deletion from succeeding

#### Scenario: S3 cleanup on expense update removing documents
- **WHEN** an expense update removes previously attached documents
- **THEN** the system deletes each removed document's S3 object after the database transaction commits
- **AND** S3 cleanup failures are logged but do not prevent the expense update from succeeding

### Requirement: Expense changed-field summary with per-field detail
The system SHALL compute a changed-field summary for expense updates using a generic differ framework. The summary includes both a field-name list and optional per-field before/after display strings.

#### Scenario: All field differs registered
- **WHEN** an expense update diff is computed
- **THEN** the composite differ checks all 10 field differs (title, amount, date, category, notes, payers, split, items, documents, recurrence) in registration order

#### Scenario: Amount changed
- **WHEN** an expense update changes amount or currency metadata
- **THEN** the changed field summary includes amount

#### Scenario: Split changed
- **WHEN** an expense update changes paid-for, paid-by, item paid-for, itemized remainder, or split mode data
- **THEN** the changed field summary includes split or payers as appropriate

#### Scenario: BY_AMOUNT payer noise suppression
- **WHEN** an expense update changes the amount while paidBySplitMode is BY_AMOUNT
- **THEN** the payer differ does NOT flag a payer change (shares derive from amount)

#### Scenario: Documents changed
- **WHEN** an expense update adds or removes expense documents
- **THEN** the changed field summary includes documents

#### Scenario: Itemized data changed
- **WHEN** an expense update changes itemized expense rows
- **THEN** the changed field summary includes items

#### Scenario: Simple metadata changed
- **WHEN** an expense update changes title, date, category, notes, or recurrence
- **THEN** the changed field summary includes the corresponding field names

#### Scenario: Change summary includes before/after strings
- **WHEN** an expense update diff is computed with a ChangeContext
- **THEN** the change summary includes per-field `before` and `after` display strings for each changed field

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

### Requirement: Expense calculation uses unified core
All expense-side share calculation — form preview, CSV export, and totals — SHALL route through the `share-calculation` core (`calculateShares` / `calculatePaidByShares`). The form `submit-values.ts` SHALL use `serializePaidFor` / `serializePaidBy` from the `share-calculation` core instead of inline per-mode conversion math. The core uses native `BigInt`-based rational arithmetic (`ExactAmount`) rather than `decimal.js`.

> **Note**: The `decimal.js` dependency has been removed. All exact arithmetic uses native `BigInt` rationals (`{ numerator, denominator }`) from the `exact-math` module. Currency conversion accepts IEEE-754 double precision for rate multiplication since the result is always rounded to the nearest integer cent.

#### Scenario: Form preview uses calculateShares
- **WHEN** the expense form renders per-participant share previews in `paid-for-row.tsx` or `paid-by-row.tsx`
- **THEN** it calls `calculateShare` / `calculatePaidByShare` which delegate to `calculateShares` / `calculatePaidByShares` from the unified core

#### Scenario: Form submission uses serializePaidFor
- **WHEN** the expense form serializes paidFor shares for API submission
- **THEN** it calls `serializePaidFor` from the `share-calculation` core and contains no inline per-mode conversion math

#### Scenario: Total active user share delegates to getBalances
- **WHEN** `getTotalActiveUserShare` or `getTotalActiveUserPaidFor` is called
- **THEN** it delegates to `getBalances(expenses.filter(e => !e.isReimbursement))` and returns the named participant's `paidFor` or `paid` value respectively

### Requirement: ITEMIZED aggregation uses global-across-items accumulation
The system SHALL compute ITEMIZED expense `paidFor` shares by accumulating exact `ExactAmount` (native `BigInt` rational) shares across all items and the "Other" filler, then truncating + distributing the single leftover once via `distributeRemainder`. This eliminates cross-item cent drift. Per-item modal preview SHALL retain per-item rounding (each item independently balances to its own amount for display).

#### Scenario: Multiple items with fractional remainders aggregate globally
- **WHEN** an ITEMIZED expense has two $50 items each split EVENLY among 3 participants
- **THEN** the aggregated `paidFor` shares are computed by accumulating exact `ExactAmount` shares across both items and distributing the single leftover once (e.g., 3333/3333/3334 rather than 3332/3334/3334)

#### Scenario: Per-item modal preview retains per-item rounding
- **WHEN** the item participants modal shows per-participant shares for a single item
- **THEN** it shows per-item integer cents that sum to the item's amount (per-item distribution), which may differ from the aggregated total by at most 1 cent

#### Scenario: Filler participates in global accumulation
- **WHEN** items sum to less than the expense amount and a synthetic "Other" filler is created
- **THEN** the filler's exact `ExactAmount` shares are accumulated into the same per-participant map before the single global distribution
