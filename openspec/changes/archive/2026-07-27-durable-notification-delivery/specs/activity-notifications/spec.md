## ADDED Requirements

### Requirement: Durable planning for coordinator-owned notifications
The system SHALL route every notification currently governed by activity notification categories through transactional durable planning, including default activity events, recurring summaries, and targeted invitation/friend events. Mandatory transactional mail outside the notification-category coordinator SHALL remain outside this delivery contract.

#### Scenario: API activity notification is produced
- **WHEN** an API mutation creates an activity whose category policy selects at least one delivery target
- **THEN** the mutation transaction creates and enqueues durable delivery rows instead of invoking an in-process dispatcher after commit

#### Scenario: Targeted category notification is produced
- **WHEN** an invitation, friend, or other targeted coordinator event identifies one recipient account and notification category
- **THEN** that event uses the same durable planning, preference resolution, idempotency, and worker delivery path

#### Scenario: Mandatory mail is sent
- **WHEN** authentication, verification, or another mandatory mail flow does not use an activity notification category
- **THEN** it remains outside `NotificationDelivery` and its call site identifies that separate contract explicitly

#### Scenario: API process starts
- **WHEN** the API server initializes
- **THEN** it initializes only the producer-side job client and MUST NOT initialize Email or Push provider dispatchers

### Requirement: Stable notification policy resolution
The producer SHALL apply existing recipient eligibility, category mapping, account override, system default, reset, and omitted-category semantics while planning delivery rows. The worker MUST NOT re-resolve those policies during an attempt.

#### Scenario: Explicit category override exists
- **WHEN** an eligible recipient has a stored channel override for the event category
- **THEN** the producer captures exactly those channels in durable delivery rows

#### Scenario: Category override is absent
- **WHEN** an eligible recipient has no stored override for the event category
- **THEN** the producer captures the system-default channels for that category

#### Scenario: Override is reset before a later event
- **WHEN** `notifications.preferences.save` receives `null` for a supplied category
- **THEN** it removes that override for later planning without altering already committed delivery rows

#### Scenario: Category is omitted from save
- **WHEN** `notifications.preferences.save` omits a category
- **THEN** that category remains unchanged and existing delivery rows remain unchanged

### Requirement: Optional email unsubscribe remains channel-specific
Optional user-facing Email delivered by the worker SHALL preserve signed unsubscribe and RFC 8058 behavior. The exact one-click POST SHALL idempotently remove Email for the represented category while preserving Push and all omitted categories.

#### Scenario: Optional email is sent durably
- **WHEN** the worker sends an Email delivery governed by an optional notification category
- **THEN** the message includes a signed category-specific unsubscribe URL plus `List-Unsubscribe` and one-click headers

#### Scenario: One-click unsubscribe is repeated
- **WHEN** the exact one-click POST is submitted more than once
- **THEN** Email remains removed for that category without error and Push remains selected

#### Scenario: User unsubscribes after another delivery was planned
- **WHEN** an Email delivery was committed before the unsubscribe request
- **THEN** that delivery retains its selected channel while later events honor the updated preference

## MODIFIED Requirements

### Requirement: Recurring notification content and transport
The system SHALL plan recurring-specific notification content as durable delivery through the `RECURRING_EXPENSE_CREATED` preference category. Schedule creation content SHALL include a human-readable recurrence rule and termination, and the worker SHALL be the only process that sends the selected Email and Push targets.

#### Scenario: Recurring schedule notification planned
- **WHEN** a recurring schedule is created with only occurrence one due through the current UTC date
- **THEN** the creation transaction durably plans one recurring-specific Email and each selected Push target for eligible affected participants and the eligible creator

#### Scenario: Generated recurring notification planned
- **WHEN** one later generated recurring expense is due outside a multi-occurrence batch
- **THEN** the materialization transaction durably plans recurring-specific content for eligible affected participants and the eligible creator before it commits

#### Scenario: Provider failure remains non-blocking
- **WHEN** recurring Email or Push provider delivery fails after materialization committed
- **THEN** the generated expense remains committed and the delivery is retried or recorded terminally according to durable failure policy

#### Scenario: Durable planning failure is atomic
- **WHEN** recurring delivery rows or their pg-boss jobs cannot be created in the materialization transaction
- **THEN** the expense, Activity, series advancement, next-occurrence job, and notification intent all roll back

### Requirement: Recurring catch-up notification summaries
The system SHALL avoid sending one Email or Push notification for every overdue occurrence. Catch-up batching SHALL be participant-scoped and persisted while retaining one `RECURRING_EXPENSE_CREATED` Activity per created expense. The summary event key SHALL be stable across worker retries, and summary delivery SHALL be planned durably in the transaction that finalizes the batch.

#### Scenario: Single due occurrence keeps normal delivery
- **WHEN** exactly one generated occurrence is due through the current UTC date
- **THEN** the materialization transaction plans the normal recurring creation delivery for that occurrence

#### Scenario: Multiple due occurrences are summarized
- **WHEN** two or more generated occurrences are due through the current UTC date during one catch-up window
- **THEN** individual generated-occurrence Email/Push delivery is suppressed and batch finalization plans each eligible participant one summary with the occurrence count and scheduled date range

#### Scenario: Initial past-dated creation is combined
- **WHEN** creating a recurring schedule makes occurrence one and at least one later occurrence immediately due
- **THEN** occurrence one seeds the persisted catch-up batch, its standalone delivery is suppressed, and finalization durably plans one combined schedule-created summary containing the total count, date range, and recurrence rule per eligible target

#### Scenario: Combined creation has no duplicate schedule message
- **WHEN** the creation catch-up summary is finalized
- **THEN** its stable event/target idempotency keys prevent a separate or duplicate schedule-created delivery for occurrence one

#### Scenario: Catch-up summary is not duplicated
- **WHEN** materialization, batch finalization, or worker processing repeats for an open or finalized catch-up batch
- **THEN** persisted batch state plus durable delivery uniqueness produces at most one delivery row per summary event, recipient, channel, and target

#### Scenario: Partial catch-up is finalized
- **WHEN** a non-empty catch-up batch is cancelled or the series is reconfigured before all overdue occurrences are generated
- **THEN** persisted batch state is cleared and no delivery is planned for ungenerated occurrences
