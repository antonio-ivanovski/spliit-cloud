## ADDED Requirements

### Requirement: Recurring expense conversion template
The system SHALL preserve CUSTOM conversion rates and SHALL resolve EXCHANGE rates on each generated occurrence date.

#### Scenario: Custom conversion repeats fixed rate
- **WHEN** a recurring template uses CUSTOM conversion
- **THEN** every generated occurrence uses the configured custom rate

#### Scenario: Exchange conversion uses occurrence date
- **WHEN** a recurring template uses EXCHANGE conversion
- **THEN** materialization requests the rate for that occurrence date and stores the resolved rate and ledger amount

#### Scenario: Exchange lookup failure
- **WHEN** the rate provider fails
- **THEN** no partial expense is created and the recurring job fails for retry

### Requirement: Recurring copy behavior
The system SHALL copy recurrence frequency, interval, and termination into a new independent series when making an expense copy.

#### Scenario: Copy recurring expense
- **WHEN** a user makes a copy of a recurring expense and saves it
- **THEN** a new series begins at sequence one with the copied recurrence configuration and the copying account as creator

### Requirement: Recurring attachments are occurrence-specific
Generated recurring expenses SHALL NOT copy document attachments from the template expense.

#### Scenario: Generated occurrence omits documents
- **WHEN** a template expense contains receipt documents
- **THEN** its generated occurrences contain no copied document references
