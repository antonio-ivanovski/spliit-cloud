## 1. Domain and database

- [x] 1.1 Add interval/year recurrence schemas, anchored date calculation, termination validation, and unit tests
- [x] 1.2 Replace the Prisma recurrence link schema with authoritative series and expense occurrence relations
- [x] 1.3 Add a transactional production migration that backfills link chains, collapses link-less recurring expenses by import fingerprint, validates, and drops the legacy recurrence schema (including `catchUpBatch` in the same migration)
- [x] 1.4 Preserve the legacy spliit.app import/export schema and map its recurrence fields into the new model
- [x] 1.5 Collapse matching legacy JSON recurring rows into one series on import (shared fingerprint with migration), schedule next occurrence after today without historical catch-up, and show collapsed schedules on the import confirm step

## 2. Worker infrastructure

- [x] 2.1 Add pg-boss dependency, shared typed job registry, environment configuration, and lifecycle helpers
- [x] 2.2 Add the standalone worker app, Docker targets, and worker Compose/Dokploy services; document the external official pg-boss dashboard boundary
- [x] 2.3 Implement recurrence materialization with locking, idempotency, retries, currency resolution, catch-up, and next-job enqueue
- [x] 2.4 Implement due-series reconciliation, archive pause/resume hooks, and worker integration tests

## 3. API behavior

- [x] 3.1 Create and update recurrence series transactionally from expense mutations and remove read-time generation
- [x] 3.2 Implement occurrence-only and this-and-future update/delete behavior
- [x] 3.3 Add series metadata, previous/next navigation, and cursor-paginated series procedures
- [x] 3.4 Add original-creator recurring activity, its independent notification category, and creator-inclusive fire-and-forget delivery

## 4. Web experience

- [x] 4.1 Add repeat-every, yearly, termination controls, and accessible next-three-date preview
- [x] 4.2 Preserve complete recurrence settings in make-copy and submission/default flows
- [x] 4.3 Add series badges, previous/next navigation, series list, and scoped edit/delete dialogs
- [x] 4.4 Add translations through the i18n CLI and web component tests

## 5. Verification

- [x] 5.1 Run Prisma generation, formatting, lint, type checks, unit tests, i18n audit, and database integration tests
- [x] 5.2 Review the combined patch for migration safety, concurrency, security, and regressions; fix all confirmed defects

## 6. Follow-up UX and deployment refinement

- [x] 6.1 Remove the dashboard from production compose/image publishing and add the upstream dashboard package to development compose only
- [x] 6.2 Replace the recurrence enable/remove controls with a full-width checkbox-controlled collapsible and add current-plus-next-three schedule preview with full-schedule summaries
- [x] 6.3 Add focused UI/configuration tests, translations, and validation for the follow-up behavior
- [x] 6.4 Keep the recurrence editor on its own full-width row at mobile and desktop breakpoints
- [x] 6.5 Show bounded indefinite schedules in the full-schedule view and make recurrence number fields temporarily clearable while editing
- [x] 6.6 Reorganize expense-form scheduling and additional-details layout for responsive alignment
- [x] 6.7 Replace recurrence selects with responsive desktop-popover/mobile-drawer choices
- [x] 6.8 Add cadence-aware occurrence presets, split-style count stepper, and connected timeline preview
- [x] 6.9 Add indexed virtual projected-schedule browsing for finite and indefinite recurrences
- [x] 6.10 Keep end-date drafts valid, clamp DATE termination when the expense date moves, and add picker keyboard navigation
- [x] 6.11 Remove redundant form framing, refine the inline timeline continuation, compact the count stepper, and correct virtual-row positioning

## 7. Recurring deletion and catch-up edge cases (follow-up)

- [x] 7.1 Make series progress monotonic across all materialization, occurrence deletion, this-and-following deletion, and this-and-future editing; ensure reconciliation never recreates deleted sequence gaps and add regression coverage
- [x] 7.2 Add the three recurring delete modes (`OCCURRENCE`, `THIS_AND_FUTURE`, and `THIS_AND_FUTURE` with `stopRecurrence: true`) with transactional, retry-idempotent behavior; keep delete-only series active and cancel only the stop variant
- [x] 7.3 Add a separate idempotent Stop Recurrence mutation that cancels future jobs while preserving every materialized expense, with authorization and API contract tests
- [x] 7.4 Implement persisted catch-up notification batches and recipient-scoped summaries for two or more overdue generated occurrences, including retry, partial failure, cancellation, and reconfiguration tests
- [x] 7.5 Update expense view/edit responsive recurring actions so all three delete choices and Stop Recurrence are explicit before confirmation, with mobile drawer/desktop popover, scope-aware labels, permissions, and translation coverage
- [x] 7.6 Add API, worker, domain, and web regression tests for count/date termination, sequence gaps, stale queued jobs, navigation skipping deleted rows, and exactly-once catch-up summaries

## 8. Recurring lifecycle notifications and cache convergence (follow-up)

- [x] 8.1 Move scoped-edit context from the fixed viewport banner to a non-sticky inline alert above the expense form, with responsive and accessibility coverage
- [x] 8.2 Extend recurring lifecycle metadata and badges for running, stopped, and completed states; map PAUSED to running and preserve terminal-series edit/delete actions while hiding Stop Recurrence
- [x] 8.3 Make initial recurring creation use recurring-specific activity/notification content with human-readable cadence and termination metadata
- [x] 8.4 Seed past-dated creation catch-up with occurrence one and emit exactly one combined schedule-created summary for all immediately due occurrences
- [x] 8.5 Record one activity per expense affected by this-and-future edit or this-and-following delete, while sending normal delivery for one row and one participant-scoped summary for multiple rows
- [x] 8.6 Add recurrence-stopped activity and EXPENSE_CHANGED delivery for standalone stop; fold delete-and-stop into its deletion notification or summary without duplicate delivery
- [x] 8.7 Broadly invalidate every group expense-list/series cache after recurring mutations and add bounded polling plus final invalidation for asynchronous creation catch-up
- [x] 8.8 Add domain, API, worker, notification renderer, and web tests for combined creation, bulk edit/delete summaries, individual feed activities, stop delivery, terminal actions, lifecycle badges, and stale-cache regressions
