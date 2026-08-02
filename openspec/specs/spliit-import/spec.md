## Purpose

Defines legacy Spliit JSON and CSV import: the immutable legacy expense shape accepted at the API boundary, recurrence collapse for historical JSON rows, the CSV recurrence limitation, and the exact-once conversion of legacy BY_SHARES weights into fixed units.

## Requirements

### Requirement: Legacy share weights convert to fixed units
The Spliit JSON import SHALL convert legacy BY_SHARES whole-number weights to fixed units exactly once, by multiplying each weight by 100 while preserving the split's ratios (`1 : 3` stays `1 : 3` as `100 : 300`). The conversion SHALL be mode-gated: rows whose `splitMode` is not BY_SHARES SHALL pass through unchanged. The import SHALL NOT guess or detect a representation at runtime — legacy exports always carry whole-number share weights, so scaling is applied deterministically on the BY_SHARES path only.

#### Scenario: BY_SHARES weights scale exactly once
- **WHEN** an imported legacy expense has `splitMode = BY_SHARES` with whole weights
- **THEN** each weight is multiplied by 100 during import and is never scaled again on any later read or write path

#### Scenario: Import preserves ratios
- **WHEN** a legacy split has weights `1` and `3`
- **THEN** the imported fixed units are `100` and `300`, keeping the exact `1 : 3` allocation ratio

#### Scenario: Other modes pass through unchanged
- **WHEN** an imported expense uses BY_AMOUNT, BY_PERCENTAGE, EVENLY, or ITEMIZED
- **THEN** its shares are imported without scaling, matching the pre-existing storage unit of that mode

#### Scenario: No runtime scale guessing
- **WHEN** the import reads a BY_SHARES expense
- **THEN** it applies the fixed `× 100` conversion from the mode declaration alone, without inferring the scale from the magnitude of the values

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
