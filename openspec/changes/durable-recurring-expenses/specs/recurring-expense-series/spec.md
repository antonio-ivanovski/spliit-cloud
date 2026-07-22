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

#### Scenario: This-and-future update
- **WHEN** a user updates one occurrence with THIS_AND_FUTURE scope
- **THEN** the selected and higher-sequence materialized expenses use the updated template and the series continues from its monotonic next unconsumed sequence

### Requirement: Monotonic deletion and recurrence stop
The system SHALL expose exactly three recurring delete actions: delete this occurrence, delete this and following, and delete this and following and stop recurrence. Deleted materialized occurrences SHALL leave no tombstone, placeholder, or financial-history row, while their consumed sequence slots remain counted by the authoritative monotonic series progress.

#### Scenario: Delete one occurrence
- **WHEN** a user confirms delete-this-occurrence
- **THEN** the selected materialized expense is removed, `occurrencesCreated` is unchanged, and the active series does not recreate that sequence

#### Scenario: Delete this and following while continuing
- **WHEN** a user confirms delete-this-and-following without stopping
- **THEN** all currently materialized expenses at or after the selected sequence are removed, the series remains active, and future generation starts at the next unconsumed sequence without replacing deleted slots

#### Scenario: Delete this and following and stop
- **WHEN** a user confirms delete-this-and-following-and-stop
- **THEN** all currently materialized expenses at or after the selected sequence are removed and the series is marked `CANCELLED`, so queued or reconciled jobs cannot materialize another occurrence

#### Scenario: Stop recurrence preserves expenses
- **WHEN** a user confirms the separate Stop Recurrence action
- **THEN** the series is marked `CANCELLED`, queued work is invalidated, and every existing materialized expense remains unchanged

#### Scenario: Terminal series remains editable
- **WHEN** a series is CANCELLED or COMPLETED
- **THEN** occurrence-only and this-and-future edit/delete actions remain available for existing materialized expenses, Stop Recurrence is absent, and no mutation resumes generation or changes the terminal status

#### Scenario: Deleted slots count toward termination
- **WHEN** materialized occurrences are deleted from a count-limited or date-limited series
- **THEN** consumed count and anchored occurrence dates remain unchanged, so deletion cannot extend, restart, or recreate the schedule

### Requirement: Series navigation
The system SHALL expose ordered occurrence metadata and cursor-paginated series history containing only existing materialized expenses; deleted sequence gaps SHALL NOT be represented as tombstones or placeholders.

#### Scenario: Adjacent occurrence navigation
- **WHEN** an expense in a series is loaded
- **THEN** its sequence and existing previous and next expense identifiers are returned

#### Scenario: Navigation skips deleted rows
- **WHEN** one or more earlier or later materialized occurrences have been deleted
- **THEN** previous/next navigation skips the missing rows and never returns a deleted placeholder

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

### Requirement: Recurrence lifecycle UI
The system SHALL communicate recurrence lifecycle status and scoped-edit context consistently on mobile and desktop.

#### Scenario: Scoped edit context stays below the header
- **WHEN** a user enters the edit form for one occurrence or this-and-future scope
- **THEN** a non-sticky inline status alert appears inside page content immediately above the expense form and is not obscured by the application header

#### Scenario: Running lifecycle badge
- **WHEN** series status is ACTIVE or PAUSED
- **THEN** the badge visibly and accessibly identifies `Recurring · Running`, combines repeat and play iconography, and uses a running-state color treatment

#### Scenario: Stopped lifecycle badge
- **WHEN** series status is CANCELLED
- **THEN** the badge visibly and accessibly identifies `Recurring · Stopped`, combines repeat and X iconography, and uses a stopped-state color treatment

#### Scenario: Completed lifecycle badge
- **WHEN** series status is COMPLETED
- **THEN** the badge visibly and accessibly identifies `Recurring · Completed`, combines repeat and check iconography, and uses a completed-state color treatment

#### Scenario: Terminal action surface
- **WHEN** a user opens recurring actions for a CANCELLED or COMPLETED series
- **THEN** edit/delete actions for one occurrence and this-and-future materialized occurrences remain available while Stop Recurrence is omitted

### Requirement: Expense-list convergence after recurring mutations
The web client SHALL converge every expense-list and series-history cache after recurring creation, editing, deletion, or stopping, including asynchronously materialized catch-up occurrences.

#### Scenario: Multi-row mutation invalidates all list variants
- **WHEN** a recurring edit or deletion affects multiple materialized expenses
- **THEN** all cached list variants for the group, series history, affected detail queries, activities, balances, and existing expense-derived summaries are invalidated or reset

#### Scenario: Past-dated creation remains fresh
- **WHEN** recurring creation starts asynchronous catch-up
- **THEN** the client temporarily polls authoritative series progress, refreshes expense data as progress changes, stops polling at completion or terminal failure, and performs one final broad invalidation

#### Scenario: Navigation observes current data
- **WHEN** the user navigates back to the expense list after recurring creation or a multi-row deletion
- **THEN** the list does not restore stale cached occurrences that were added or removed by the operation

### Requirement: Legacy recurrence migration
The system SHALL transactionally migrate every open legacy schedule to the new series model and SHALL remove the legacy table only after validation.

#### Scenario: Validation failure rolls back
- **WHEN** an open legacy link cannot be mapped to exactly one preserved schedule
- **THEN** the migration aborts without dropping legacy recurrence data
