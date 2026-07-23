# Recurring Expense Lifecycle and Notifications — Implementation Handoff

Status: planned follow-up to `openspec/changes/durable-recurring-expenses`.

This handoff is self-contained. Implement it against the existing recurring-expense work. The OpenSpec artifacts are authoritative if implementation details drift.

## Outcomes

1. Move scoped-edit context into safe page content.
2. Produce recurrence-aware creation, bulk mutation, and stop notifications.
3. Keep one feed activity per affected expense while coalescing multi-expense email/push delivery.
4. Make recurring status and available actions accurate for active, stopped, and completed schedules.
5. Eliminate stale expense lists after multi-row mutations and asynchronous catch-up.

## Confirmed product decisions

- Past-dated recurring creation that immediately creates multiple occurrences sends one combined notification, not a schedule-created notification plus a catch-up notification.
- A recurring operation affecting one materialized expense uses normal delivery. Two or more affected expenses use one summary with count and scheduled date range.
- The activity feed retains individual activities for every created, edited, or deleted expense even when channel delivery is summarized.
- Schedule creation uses `RECURRING_EXPENSE_CREATED`. Edit, delete, and stop use `EXPENSE_CHANGED`.
- Standalone stop recipients are eligible active account-backed participants from the series template, with the actor excluded.
- CANCELLED and COMPLETED series retain occurrence-only and this-and-future edit/delete actions for materialized rows; they do not show Stop Recurrence.
- PAUSED is displayed as Running for lifecycle UI simplicity.
- The edit-scope banner becomes a non-sticky inline alert immediately above the form.
- Past-dated asynchronous catch-up uses temporary polling and a final broad invalidation.

## Current implementation seams

| Concern                                        | Primary files                                                                                                                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expense create/update/delete/stop transactions | `apps/api/src/lib/api/expenses.ts`                                                                                                                                                |
| Recurrence materialization and catch-up state  | `apps/api/src/lib/api/recurrence-series.ts`                                                                                                                                       |
| Worker notification emission                   | `apps/worker/src/handlers.ts`                                                                                                                                                     |
| Activity types and payload validation          | `packages/domain/src/activities/types.ts`, `packages/domain/src/activities/payload.ts`                                                                                            |
| Notification category mapping                  | `packages/domain/src/notifications.ts`                                                                                                                                            |
| Recipient selection                            | `apps/api/src/lib/notifications/handlers.ts`                                                                                                                                      |
| Email/push renderers                           | `apps/api/src/lib/notifications/expense-email-dispatcher.ts`, `apps/api/src/lib/notifications/expense-push-dispatcher.ts`, `apps/api/src/lib/mail/templates/expense-activity.tsx` |
| Mutation invalidation                          | `apps/web/src/app/groups/[groupId]/expenses/expense-mutation-hooks.ts`                                                                                                            |
| Scope banner                                   | `apps/web/src/app/groups/[groupId]/expenses/edit-expense-form.tsx`                                                                                                                |
| Recurring actions                              | `apps/web/src/app/groups/[groupId]/expenses/recurring-actions-menu.tsx`, `apps/web/src/app/groups/[groupId]/expenses/expense-preview-modal.tsx`                                   |
| Status badge                                   | `apps/web/src/app/groups/[groupId]/expenses/series-controls.tsx`                                                                                                                  |
| English source strings                         | `apps/web/src/messages/en-US.json` via the `bun i18n` CLI only                                                                                                                    |

Known issues in the current seam:

- `createExpense` records and dispatches `EXPENSE_CREATED` even when it creates a recurrence.
- Multi-row update/delete currently centers notification/activity data on the selected expense instead of every affected row.
- `stopRecurrence` changes state without an activity or notification and does not receive actor context in the shared API function.
- The preview derives status from nested `recurringSeries`/`series`, while list/detail output also exposes `recurringSeriesStatus`; normalize this contract instead of adding more frontend fallbacks.
- Delete optimistically removes only the selected ID and invalidates side effects without broadly resetting list variants, leaving other deleted rows cached.
- Existing invalidation targets only the empty-filter list input, so filtered, paginated, or series-scoped caches can remain stale.

## Event and payload design

### Activity taxonomy

Use explicit activity types rather than overloading generic payload text:

- Keep `RECURRING_EXPENSE_CREATED` for both occurrence one and worker-generated occurrences.
- Keep `EXPENSE_UPDATED` and `EXPENSE_DELETED` per affected materialized row.
- Add `RECURRING_EXPENSE_STOPPED` for schedule stopping. Map it to `EXPENSE_CHANGED`.

Extend activity payload schemas with typed notification-only or recurrence metadata variants rather than passing unvalidated objects. At minimum recurrence metadata needs:

- `seriesId`
- human-renderable cadence: frequency and interval
- termination kind plus count/end date where applicable
- affected participant IDs
- affected occurrence count
- scheduled start/end date for summaries
- operation kind: create, update, delete, stop
- `stopped: boolean` for delete-and-stop summary rendering

Individual delete activities must snapshot enough title, amount, currency, scheduled date, and participant data before rows are removed. Individual update activities must calculate changes against each row's pre-update state; do not copy the selected row's change payload to all rows when date-sensitive conversion or row state differs.

### Recipient rules

- Creation/generated occurrence: eligible participants plus the eligible original creator, preserving the existing recurring-creator exception.
- Update/delete summaries: union affected participant IDs across every affected row, filter to active account-backed members, exclude the actor, and deduplicate by account.
- Standalone stop: derive participant IDs from the persisted recurring template, filter eligibility, exclude the actor.
- Delete-and-stop: use the deletion recipient union. Do not enqueue a second stopped delivery.

### Delivery grouping

Keep activity persistence separate from delivery grouping:

- One affected row: dispatch the normal activity event.
- Multiple affected rows: persist all individual activities, suppress their individual email/push fan-out, and dispatch one typed summary event after commit.
- Give each summary a deterministic operation/event ID based on committed identity, not timestamps or random retry-local values. The existing fire-and-forget coordinator is accepted by this change, but repeated callbacks in one process must not create duplicate summary events.

For request-driven bulk operations, return or retain the committed activity IDs and use a stable operation ID covering series ID, mutation kind, anchor sequence, and the transaction's committed activity set. Do not make notification sending part of the database transaction.

## Combined recurring creation

The manually entered first occurrence must participate in the catch-up batch when more than one occurrence is immediately due.

Suggested transaction flow:

1. Calculate how many schedule slots are due from the anchor through the current UTC date before committing creation.
2. Record occurrence one as `RECURRING_EXPENSE_CREATED`, including cadence and termination metadata.
3. If only occurrence one is due, commit and dispatch its special recurring schedule-created notification normally.
4. If more than one is due, create `catchUpBatch` in the creation transaction with count `1`, start/end at occurrence one's date, a cutoff through the current UTC date, participant scope, recurrence metadata, and a mode such as `INITIAL_CREATION`.
5. Suppress occurrence one's standalone delivery. Worker materialization appends later due occurrences and their individual activities.
6. When the worker advances past the cutoff, emit one stable combined summary containing the total count, date range, expense title, and human-readable recurrence rule.
7. Clear the batch only after constructing the stable summary event. Retries must observe finalized/cleared state and must not send a separate creation notification.

Do not include future, not-yet-due schedule slots in the summary count. Do not emit notifications for occurrences that failed to materialize.

## Bulk edit and delete transaction behavior

Resolve the full affected row set under the recurring-series lock before mutation, ordered by `recurrenceSequence`.

For this-and-future edit:

- Update every selected/higher-sequence materialized row as the current behavior intends.
- Record one `EXPENSE_UPDATED` activity per actually changed row.
- Preserve CANCELLED/COMPLETED status. Editing a terminal series must not enqueue work, change `nextOccurrenceDate`, or reactivate it.
- If zero rows actually change, do not send a misleading summary.
- Dispatch normal delivery for one changed row, summary delivery for two or more.

For this-and-following delete:

- Snapshot all affected rows before `deleteMany`.
- Record one `EXPENSE_DELETED` activity per removed row.
- Delete-only preserves the existing series status. Delete-and-stop changes an active/paused series to CANCELLED; an already terminal series remains terminal.
- One deletion uses normal delivery. Multiple deletions use one summary.
- Delete-and-stop adds stopped wording to that same notification/summary and emits no separate stopped delivery.

All summary counts and date ranges are based on rows actually changed/deleted, not the theoretical schedule.

## Standalone stop

Change the shared `stopRecurrence` API to accept actor context. In the same transaction as the status change:

- Lock the series.
- No-op cleanly if it is already CANCELLED or COMPLETED; a no-op emits no new activity or notification.
- For ACTIVE or PAUSED, mark CANCELLED, bump version, clear catch-up state, and record one `RECURRING_EXPENSE_STOPPED` activity with recurrence metadata and template participant IDs.

After commit, dispatch through the same email/push infrastructure and visual language used for expense deletion, under `EXPENSE_CHANGED`. Existing materialized expenses remain untouched.

## Lifecycle UI

### Scoped-edit alert

Remove the fixed `top-0` banner from `edit-expense-form.tsx`. Render a normal-flow status alert in page content immediately above `ExpenseForm`. It should:

- identify “Editing only this occurrence” or “Editing this and future occurrences”;
- use `role="status"` or an appropriate accessible alert primitive;
- remain visible without covering the app header;
- wrap cleanly on narrow screens;
- not be sticky or portal-mounted.

### Badge mapping

Normalize API status into one badge component:

| Series status | Visible state | Icon treatment | Suggested semantic color |
| ------------- | ------------- | -------------- | ------------------------ |
| ACTIVE        | Running       | Repeat + play  | green/positive           |
| PAUSED        | Running       | Repeat + play  | green/positive           |
| CANCELLED     | Stopped       | Repeat + X     | muted/destructive        |
| COMPLETED     | Completed     | Repeat + check | subdued green/success    |

Visible text should be `Recurring · Running`, `Recurring · Stopped`, or `Recurring · Completed`. Include the state in accessible text; color alone is insufficient. A small composed icon is acceptable, but two aligned Lucide icons are preferable if composition becomes visually fragile.

### Action mapping

- ACTIVE/PAUSED: edit occurrence, edit this-and-future, three delete choices, and standalone Stop Recurrence.
- CANCELLED/COMPLETED: edit occurrence, edit this-and-future, delete occurrence, and delete this-and-following. Hide any action whose only distinction is stopping recurrence, including standalone Stop and delete-this-and-following-and-stop.

For terminal series, “future” means materialized rows with sequence at or above the selected row. UI descriptions must say that no schedule will restart.

## Cache convergence

Replace exact-input-only invalidation with group-wide invalidation/reset for `groups.expenses.list`. Include filtered lists, pagination, series filtering, and any infinite-query pages. Also invalidate:

- affected `groups.expenses.get` queries;
- series history/list procedures;
- group activities;
- balances/overview queries derived from expenses;
- common currencies, leave preview, and invitation revoke preview as already done.

Avoid optimistic multi-delete unless every affected ID is returned by the mutation and can be removed from every cached page. The safer implementation is to close/navigate after success and `await` a broad list reset before considering the mutation settled.

For asynchronous past catch-up, expose a small stable API progress shape rather than leaking raw `catchUpBatch` JSON, for example:

```ts
type RecurringCatchUpProgress = {
  seriesId: string
  pending: boolean
  materializedCount: number
  dueThrough: string | null
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
}
```

Return the series ID/progress from recurring creation or make it immediately queryable. While `pending` is true, poll at a modest interval (suggested 1–2 seconds), broadly refresh expense data when count changes, and stop on `pending === false`, terminal series status, component unmount, or a bounded timeout. Always perform one final broad invalidation. Refetch-on-mount/focus remains enabled as a safety net.

Do not poll indefinite active schedules after initial catch-up completes.

## Suggested implementation sequence

1. Extend activity types, payload schemas, category mapping, and renderer input types with tests.
2. Refactor recurring creation to log occurrence one as recurring and seed combined initial catch-up state.
3. Extend worker finalization/rendering for combined creation summaries.
4. Refactor bulk update/delete to snapshot rows, write individual activities, and dispatch one-or-many delivery correctly.
5. Add standalone stop activity/notification and delete-and-stop folding.
6. Normalize series status in API outputs and implement terminal-safe backend mutations.
7. Update inline scope alert, lifecycle badge, and status-driven action menu.
8. Broaden invalidation and add bounded catch-up progress polling.
9. Add translations through the `translate-strings` skill and `bun i18n` CLI; never hand-edit locale JSON.
10. Run focused tests, full unit checks, formatting, lint, type checking, and the OpenSpec validator.

## Test matrix

### Domain/API

- Initial recurring creation records `RECURRING_EXPENSE_CREATED` with cadence/termination data.
- Past creation with N due rows records N individual activities and produces one combined summary.
- This-and-future update records one activity per changed row; one row uses normal delivery, multiple use one summary.
- This-and-following delete records snapshots for every deleted row; one row uses normal delivery, multiple use one summary.
- Delete-and-stop has stopped wording and no second stop delivery.
- Standalone stop selects template participants, excludes actor, and is idempotent.
- CANCELLED/COMPLETED scoped edits preserve status and do not enqueue recurrence work.

### Worker/notifications

- Initial batch includes occurrence one and uses an exactly stable summary ID under retries.
- Failed partial materialization counts only committed rows.
- Email and push render cadence, termination, count, date range, and stopped state correctly.
- Recipient union deduplicates accounts and excludes inactive/unlinked/placeholder recipients.

### Web

- Inline scope alert is in normal layout and visible below the header at mobile and desktop widths.
- ACTIVE and PAUSED render Running; CANCELLED renders Stopped; COMPLETED renders Completed.
- Terminal series retain materialized edit/delete scopes and hide both stop variants.
- Multi-delete removes every affected row after navigation, including filtered/series list caches.
- Past creation polling shows newly materialized rows without a hard reload and stops after convergence.

## Validation commands

Do not start dev services or the API server without explicit user permission.

```bash
bun prisma-generate             # only if schema changes
bun check-types
bun lint
bun check-formatting
bun i18n check --changes-only
bun run test
bunx openspec validate durable-recurring-expenses --type change --strict --no-interactive
git diff --check
```

Run real-database integration tests only when their prerequisites already exist; never start the dev server automatically. Do not run the broken Playwright E2E suite.

## Done when

- Every acceptance scenario in OpenSpec section 8 is covered by implementation and tests.
- One user action never creates duplicate email/push delivery.
- Feed history remains per-expense even when notification delivery is summarized.
- Terminal series actions and status are correct immediately after mutation and after navigation.
- Past-dated creation and multi-row deletion converge without a manual reload.
- All translations and repository validation gates pass.
