## ADDED Requirements

### Requirement: Interval recurrence schedule
The system SHALL support recurrence every 1 through 99 days, weeks, months, or years, anchored to the entered expense date.

#### Scenario: Anchored monthly calculation
- **WHEN** a monthly series starts on January 31
- **THEN** February clamps to its last day and March returns to March 31

#### Scenario: Anchored yearly leap calculation
- **WHEN** a yearly series starts on February 29
- **THEN** non-leap occurrences use February 28 and later leap occurrences return to February 29

### Requirement: Past and future start semantics
Occurrence one SHALL be created immediately and later occurrences SHALL be scheduled strictly from its expense date.

#### Scenario: Past start catches up
- **WHEN** occurrence one is dated in the past
- **THEN** every due date after occurrence one through today is materialized asynchronously in order

#### Scenario: Future start does not backfill
- **WHEN** occurrence one is dated in the future
- **THEN** no intervening expenses are created and occurrence two is scheduled one configured interval after occurrence one

### Requirement: Recurrence termination
The system SHALL support indefinite, total-count, and inclusive end-date termination, with occurrence one included in the count.

#### Scenario: Count completes series
- **WHEN** the created occurrence count reaches the configured total
- **THEN** the series is completed and no next job is scheduled

#### Scenario: Inclusive end date
- **WHEN** a calculated occurrence falls exactly on the configured end date
- **THEN** it is created and the series completes afterward

### Requirement: Series mutation scopes
The system SHALL allow occurrence-only and this-and-future mutation scopes for recurring expenses.

#### Scenario: Occurrence-only update
- **WHEN** a user updates one occurrence with OCCURRENCE scope
- **THEN** the series template and other occurrences remain unchanged

#### Scenario: This-and-future deletion
- **WHEN** a user confirms deletion with THIS_AND_FUTURE scope
- **THEN** the selected and higher-sequence expenses are deleted and the series is cancelled

### Requirement: Series navigation
The system SHALL expose ordered occurrence metadata and cursor-paginated series history.

#### Scenario: Adjacent occurrence navigation
- **WHEN** an expense in a series is loaded
- **THEN** its sequence and existing previous and next expense identifiers are returned

### Requirement: Archive behavior
The system SHALL pause active series while their group is archived and resume at the next future occurrence without backfilling the archived interval.

#### Scenario: Unarchive skips archived dates
- **WHEN** an archived group is restored
- **THEN** each paused series advances to its next future scheduled date without consuming count for skipped dates

### Requirement: Recurrence UI preview
The expense form SHALL show an accessible current-occurrence marker and up to three upcoming occurrence dates when recurrence is enabled, and SHALL provide a responsive full-schedule view or bounded summary for longer schedules. Scheduling controls SHALL be grouped with the expense date, while notes and settlement options SHALL be aligned in a deliberate full-width additional-details area without redundant enclosing borders. The recurrence editor SHALL remain the single bordered scheduling surface and SHALL occupy its own full-width grid row on mobile and desktop. Frequency and termination choices SHALL use a desktop dropdown/popover and a bottom drawer on mobile, with arrow-key, Home/End, Escape, and typeahead keyboard behavior. Occurrence counts SHALL support compact side-button increment/decrement controls without native browser steppers, cadence-aware presets, and temporarily empty drafts while editing, but SHALL normalize to valid values before submission. DATE termination edits SHALL remain valid when cleared temporarily, and moving the expense date beyond the configured end date SHALL clamp the end date to the new anchor before submission. The inline schedule preview SHALL use a connected timeline, place occurrence labels above their markers, show the current occurrence plus up to three future occurrences, and include a visible continuation marker linked to the full-schedule action when later occurrences are hidden. The full-schedule view SHALL virtualize indexed rows from the top of a single scroll viewport, progressively load finite schedules until every occurrence is reachable, progressively load indefinite schedules while indicating that the series has no end, and avoid eagerly materializing the complete date list.

#### Scenario: Preview respects termination
- **WHEN** recurrence fields change
- **THEN** the preview recalculates immediately, marks the edited or created expense as current, and omits dates beyond count or end-date termination

#### Scenario: Full schedule is bounded
- **WHEN** more than three future occurrences exist
- **THEN** the form offers a responsive virtual schedule view; it makes every finite current-and-future date reachable through lazy scrolling, progressively loads indefinite dates, and identifies indefinite schedules as having no end

### Requirement: Legacy recurrence migration
The system SHALL transactionally migrate every open legacy schedule to the new series model and SHALL remove the legacy table only after validation.

#### Scenario: Validation failure rolls back
- **WHEN** an open legacy link cannot be mapped to exactly one preserved schedule
- **THEN** the migration aborts without dropping legacy recurrence data
