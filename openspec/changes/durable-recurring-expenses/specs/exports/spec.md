## ADDED Requirements

### Requirement: Interval recurrence export
Exports SHALL represent recurrence frequency, interval, and termination for series expenses.

#### Scenario: Export recurring expense
- **WHEN** an exported expense belongs to a series
- **THEN** its export data identifies the series recurrence configuration and occurrence sequence

### Requirement: Legacy recurrence import compatibility
Imports SHALL continue accepting legacy DAILY, WEEKLY, and MONTHLY recurrence rules by mapping them to interval one and indefinite termination.

#### Scenario: Import legacy monthly rule
- **WHEN** an import contains recurrenceRule MONTHLY
- **THEN** the imported recurrence uses monthly frequency, interval one, and indefinite termination

### Requirement: Legacy recurring import collapse
The Spliit JSON importer SHALL collapse matching historical recurring expense rows into one `RecurringExpenseSeries` with ordered `recurrenceSequence` values. Matching uses the same conservative fingerprint as legacy recurrence migration for link-less rows: title, recurrence rule, amount, split mode, reimbursement flag, sorted paid-by and paid-for participant shares, original currency, and conversion rate. The series template and `anchorDate` SHALL come from the latest expense date in each collapsed group.

#### Scenario: Multiple matching monthlies become one series
- **WHEN** an import batch contains multiple expenses with the same fingerprint and non-NONE recurrence rule
- **THEN** the importer creates one series, assigns sequences `1..N` in expense-date order, sets `occurrencesCreated` to `N`, and links every matching expense to that series

#### Scenario: Different amount stays separate
- **WHEN** two imported recurring rows share a title and rule but differ in amount or participant split fingerprint
- **THEN** they become separate series

#### Scenario: Import does not schedule historical catch-up
- **WHEN** imported historical occurrences are entirely before the current UTC calendar day
- **THEN** the created series sets `nextOccurrenceDate` to the first schedule date strictly after today using anchored occurrence math and does not enqueue a backlog of missed pre-import occurrences

#### Scenario: Import cursor ordinal matches advanced next date
- **WHEN** the importer advances `nextOccurrenceDate` past overdue historical anchors
- **THEN** it sets `nextOccurrenceOrdinal` to the 1-based anchored ordinal for that date so materialization validation succeeds

#### Scenario: Import month-end overdue skip stays on day 31
- **WHEN** imported MONTHLY rows are anchored on the 31st and overdue skip advances past February
- **THEN** the next cursor uses the anchored 31st (or that month's last day only when short), not iterative clamp drift

#### Scenario: Import leap-day overdue skip recovers Feb 29
- **WHEN** imported YEARLY rows are anchored on February 29 and overdue skip advances past non-leap years
- **THEN** the next cursor follows anchored leap-day rules so materialization validation succeeds

#### Scenario: Legacy CSV rows are never recurring
- **WHEN** the user imports a legacy Spliit CSV file
- **THEN** every expense is committed without a series and recurrence is not inferred from the file
