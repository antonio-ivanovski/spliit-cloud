## Purpose

Defines recurring expense series behavior: interval schedules anchored to an entered date, anchored next-cursor consistency across migration, import, and materialization, termination modes, mutation scopes, deletion semantics, navigation, lifecycle UI, legacy migration, and fixed share-unit template storage.

## Requirements

### Requirement: Templates store fixed share units
Recurring templates SHALL store participant shares in fixed units (`100 = 1 displayed share`) for flat paidFor rows, paidBy rows, item paidFor rows, and itemized-remainder paidFor rows. Materialization SHALL copy the template's stored shares unchanged into each generated occurrence, because the display-to-fixed-unit conversion happens exactly once at expense-creation serialization; templates and occurrences SHALL never rescale share values.

#### Scenario: Template stores fixed units
- **WHEN** a recurring expense template is saved with displayed shares like `1.1` or `0.5`
- **THEN** the template stores the fixed units `110` and `50`

#### Scenario: Occurrence copies shares unchanged
- **WHEN** a materialized occurrence is created from a template
- **THEN** every flat paidFor and paidBy row copies the template's stored fixed share units verbatim

#### Scenario: Item and remainder paths copy unchanged
- **WHEN** a template contains itemized splits or an itemized remainder
- **THEN** the generated occurrence copies each item's and the remainder's fixed share units verbatim

### Requirement: Interval recurrence schedule
The system SHALL support recurrence every 1 through 99 days, weeks, months, or years, anchored to the entered expense date.

#### Scenario: Anchored monthly calculation
- **WHEN** a monthly series starts on January 31
- **THEN** February clamps to its last day and March returns to March 31

#### Scenario: Anchored yearly leap calculation
- **WHEN** a yearly series starts on February 29
- **THEN** non-leap occurrences use February 28 and later leap occurrences return to February 29

### Requirement: Anchored next-cursor consistency
Migration overdue skip, JSON import overdue skip, and recurring materialization SHALL compute occurrence dates from the series `anchorDate` and a 1-based occurrence ordinal using the same anchored calendar rules as `calculateRecurrenceDate`. They SHALL NOT advance schedules by repeatedly adding one interval to the previous occurrence date (legacy iterative stepping), which drifts month-end and leap-day anchors and causes materialization to reject stored cursors.

#### Scenario: Materialization rejects mismatched cursor
- **WHEN** a materialization job's `occurrenceDate` does not equal the anchored date for the series anchor, frequency, interval, and `nextOccurrenceOrdinal`
- **THEN** the worker does not create an expense and does not advance the series

#### Scenario: Migration and import share overdue-skip math
- **WHEN** legacy migration or JSON import advances `nextOccurrenceDate` past overdue historical anchors
- **THEN** it sets `nextOccurrenceOrdinal` to the anchored ordinal for that date using the same rules as materialization validation

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

#### Scenario: This-and-future schedule reflow
- **WHEN** a user changes frequency, interval, or termination with THIS_AND_FUTURE scope
- **THEN** future materialized expenses are re-dated onto the new schedule from the edited occurrence, rows outside the new termination are deleted, missing due occurrences through today are catch-up materialized, and past-before-anchor rows remain unchanged

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
The expense form SHALL show an accessible current-occurrence marker and up to three upcoming occurrence dates when recurrence is enabled, and SHALL provide a responsive full-schedule view or bounded summary for longer schedules. Scheduling controls SHALL be grouped with the expense date, while notes and settlement options SHALL be aligned in a deliberate full-width additional-details area without redundant enclosing borders. The recurrence editor SHALL remain the single bordered scheduling surface and SHALL occupy its own full-width grid row on mobile and desktop. Frequency and termination choices SHALL use a desktop dropdown/popover and a bottom drawer on mobile, with arrow-key, Home/End, Escape, and typeahead keyboard behavior. Occurrence counts SHALL support compact side-button increment/decrement controls without native browser steppers, cadence-aware presets, and temporarily empty drafts while editing, but SHALL normalize to valid values before submission. DATE termination edits SHALL remain valid when cleared temporarily, and moving the expense date beyond the configured end date SHALL clamp the end date to the new anchor before submission. The inline schedule preview SHALL use a connected timeline, place occurrence labels above their markers, show the current occurrence plus up to three future occurrences, mark projected dates on or before today as completed, and include a visible continuation marker linked to the full-schedule action when later occurrences are hidden. The full-schedule view SHALL present a vertical connected timeline, virtualize indexed rows from the top of a single scroll viewport, progressively load finite schedules until every occurrence is reachable, progressively load indefinite schedules while indicating that the series has no end, and avoid eagerly materializing the complete date list. When the expense date is in the past and further projected occurrences fall on or before today, the form SHALL show a note that those occurrences will be created after save. When editing with THIS_AND_FUTURE scope and the user changes frequency, interval, or termination, the form SHALL warn that saving will reschedule future occurrences (including possible date moves, deletions, and catch-up creates).

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
The system SHALL transactionally migrate legacy recurrence data to `RecurringExpenseSeries` in a single Prisma SQL migration that also creates `catchUpBatch` on the series table. The migration SHALL backfill link chains, collapse link-less recurring expenses, validate invariants, and only then drop `RecurringExpenseLink` and `Expense.recurrenceRule`. Any validation failure SHALL abort the transaction and preserve the legacy schema.

#### Scenario: Validation failure rolls back
- **WHEN** an open legacy link cannot be mapped to exactly one preserved schedule
- **THEN** the migration aborts without dropping legacy recurrence data

#### Scenario: Link chains become one series
- **WHEN** legacy `RecurringExpenseLink` rows form a chain for one schedule
- **THEN** the migration creates one series per chain root, assigns each materialized frame a monotonic `recurrenceSequence`, preserves the open leaf's stored `nextExpenseDate` as `nextOccurrenceDate`, and does not recreate already-materialized occurrences

#### Scenario: Ambiguous next-frame edges abort
- **WHEN** legacy catch-up wrote multiple candidate next expenses for the same closed link and edge reconstruction cannot pick exactly one next frame (preferring `expenseDate = nextExpenseDate`, then a unique `createdAt` match)
- **THEN** the migration aborts rather than attaching frames to the wrong series

#### Scenario: Closed leaf without terminal expense stays schedulable
- **WHEN** the latest link is closed but the terminal expense row was deleted
- **THEN** the series remains schedulable (not falsely marked `COMPLETED`), advances from the slot after the stored `nextExpenseDate`, and does not truncate recoverable history when a date-aligned terminal expense still exists

#### Scenario: Link-less recurring expenses collapse by fingerprint
- **WHEN** a recurring expense has no legacy link and is not the next frame of a chain edge
- **THEN** it is grouped with other link-less rows on the same ledger that share the legacy import fingerprint (title, recurrence rule, amount, split mode, settlement category / legacy `isReimbursement` alias, sorted paid-by and paid-for participant shares, original currency, conversion rate), sorted by expense date, and migrated as one series with sequences `1..N` anchored on the latest row

#### Scenario: Fingerprint mismatch stays separate
- **WHEN** two link-less recurring rows share a title but differ in amount, participants, or other fingerprint fields
- **THEN** they become separate series rather than being merged heuristically by title alone

#### Scenario: Collapsed orphans do not catch up history
- **WHEN** collapsed orphan series are created on non-archived groups
- **THEN** `nextOccurrenceDate` is advanced with anchored occurrence math to the first schedule date strictly after the migration day's UTC calendar date and reconcile does not enqueue a historical backlog for pre-migration rows

#### Scenario: Month-end orphan cursor stays materializable
- **WHEN** a collapsed MONTHLY orphan series is anchored on day 31 and overdue skip advances `nextOccurrenceOrdinal` beyond 2
- **THEN** `nextOccurrenceDate` remains the anchored day-31 (or that month's last day only when short), matching worker `calculateRecurrenceDate`, not iterative clamp drift from February

#### Scenario: Leap-day orphan cursor recovers Feb 29
- **WHEN** a collapsed YEARLY orphan series is anchored on February 29 and overdue skip advances past non-leap years
- **THEN** `nextOccurrenceDate` uses the anchored leap-day rules (Feb 28 in non-leap years, Feb 29 on leap years) so materialization can succeed

#### Scenario: ACTIVE cursor is materializable
- **WHEN** a migrated series is `ACTIVE`
- **THEN** `nextOccurrenceDate` equals the anchored occurrence date for `nextOccurrenceOrdinal` computed from the series anchor, matching worker validation

#### Scenario: Scoped stop and delete use collapsed membership
- **WHEN** a user stops recurrence or deletes this-and-following on any expense in a collapsed series
- **THEN** the operation applies to the shared `recurringSeriesId` and all materialized rows at or after the selected `recurrenceSequence` in that series
