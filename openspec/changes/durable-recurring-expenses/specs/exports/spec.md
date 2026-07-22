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
