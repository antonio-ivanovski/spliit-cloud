## ADDED Requirements

### Requirement: Legacy JSON recurring import collapse
The Spliit JSON import commit path SHALL collapse matching historical `recurrenceRule` rows into one `RecurringExpenseSeries` before creating expenses, using the same conservative fingerprint as legacy recurrence migration for link-less rows (title, recurrence rule, amount, split mode, reimbursement flag, sorted paid-by and paid-for participant shares, original currency, conversion rate). Overdue skip SHALL set `nextOccurrenceDate` and `nextOccurrenceOrdinal` with anchored occurrence math (same as materialization), not iterative next-from-previous stepping.

#### Scenario: Confirm summary matches collapsed series
- **WHEN** the user reaches the import confirm step and the parsed batch contains recurring JSON rows
- **THEN** the summary lists one entry per collapsed series with expense title and human-readable cadence (Daily, Weekly, or Monthly), not one entry per historical occurrence

#### Scenario: Collapse planner matches server commit
- **WHEN** the user confirms a JSON import with recurring rows
- **THEN** the web confirm summary and the server `importGroup` commit use the same collapse planner so listed schedules match created series

#### Scenario: Import overdue skip uses anchored ordinals
- **WHEN** imported historical rows are entirely before the current UTC calendar day and the anchor is on a month-end or leap day
- **THEN** the created series sets `nextOccurrenceDate` and `nextOccurrenceOrdinal` from anchored occurrence math so the worker can materialize the next occurrence

### Requirement: Spliit CSV recurrence limitation
The legacy Spliit CSV wire format SHALL NOT carry recurrence. The CSV parser SHALL set every row to non-recurring and SHALL reject headers that match Cloud recurrence columns.

#### Scenario: CSV import has no recurring schedules
- **WHEN** the user imports a legacy Spliit CSV file
- **THEN** no `RecurringExpenseSeries` rows are created and the confirm summary omits the recurring-schedules list

#### Scenario: Source step discloses JSON for recurrence
- **WHEN** the user is on the Spliit source step with file upload enabled
- **THEN** the UI states that CSV exports do not include recurrence and that JSON export from spliit.app is required to import recurring expenses

### Requirement: Legacy import API transport boundary
The `groups.import` mutation SHALL accept only the immutable legacy spliit.app expense shape. Internal Cloud `recurrence` objects, series identifiers, and sequence numbers SHALL be stripped at the API boundary and SHALL NOT influence series creation.

#### Scenario: Cloud recurrence fields stripped on import
- **WHEN** an import payload includes Cloud recurrence metadata alongside legacy fields
- **THEN** the server ignores the Cloud recurrence object and maps recurrence only from `recurrenceRule` when it is not `NONE`
