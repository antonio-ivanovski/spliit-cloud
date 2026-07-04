## Why

Spliit currently records only a small set of coarse activity events, so important group, invitation, member, and expense changes are either missing from the user-facing activity timeline or rendered as generic group updates. Expense changes also do not notify affected active participants, which makes edits and deletions easy to miss.

## What Changes

- Expand activity events into a richer, user-facing timeline for group settings, archive state, invitations, member lifecycle, role changes, expense create/update/delete, and bulk import summaries.
- Simplify the `Activity` table into a generic event-log shape with typed `type`, `actorType`/`actorId`, `subjectType`/`subjectId`, and typed JSON `data`.
- Store activity type, actor type, and subject type as database strings typed in Prisma Client via externally provided `PrismaJson` types inferred from shared Zod schemas, and store activity payloads as typed JSON with a discriminated union shared between API and web.
- Migrate existing activity type string values to clearer event names:
  - `CREATE_EXPENSE` -> `EXPENSE_CREATED`
  - `UPDATE_EXPENSE` -> `EXPENSE_UPDATED`
  - `DELETE_EXPENSE` -> `EXPENSE_DELETED`
  - `UPDATE_GROUP` -> `GROUP_UPDATED`
- Add a generic differ framework (`activity-diff`) supporting field-group diffing with both coarse `changedFields` lists and per-field `before`/`after` change detail strings. Implement concrete differs for expense changes (title, amount, date, category, notes, payers, split, items, documents, recurrence) and group changes (name, information, currency, plus `linkedParticipant` handled separately in ledger-participant linking).
- Add lightweight expense diff summaries for activity display and email copy, covering both a field-list summary and optional per-field before/after value strings.
- Send immediate expense email notifications after the domain mutation commits, without failing the action if delivery fails. Notifications are also sent for settlement expenses generated during member leave/removal/archive flows and for recurring-expense auto-creation.
- Deliver expense emails only to affected active, accepted, account-backed group members, excluding the actor.
- Add bulk import summary notification (`EXPENSES_IMPORTED`) that sends a single summary email per active affected member when expenses are imported in bulk (e.g. from Splitwise CSV).
- Skip email delivery for pending invitees, unlinked participants, left/removed members, placeholder emails, and all invitation/member/group events in this first pass.
- Introduce a notification dispatcher abstraction that can later be backed by durable `NotificationDelivery` rows and retry processing without changing mutation call sites.
- Support `SYSTEM` actor type for auto-generated activities such as recurring-expense creation.

## Capabilities

### New Capabilities

- `activity-notifications`: Immediate notification dispatch for activity events, initially limited to expense email notifications for eligible affected participants and bulk import summary notifications.

### Modified Capabilities

- `activities`: Activity events become richer typed timeline events with structured JSON payloads and expanded event types including `EXPENSES_IMPORTED` for bulk import summaries.
- `expenses`: Expense create/update/delete mutations record structured activity and trigger immediate eligible-recipient email notifications. Settlement expenses generated during member/group lifecycle changes also trigger notifications.
- `group-membership`: Membership and invitation lifecycle changes record user-facing activity events, and activity visibility remains limited to currently authorized group viewers.

## Impact

- Prisma schema and migration for generic `Activity` event fields and typed JSON `Activity.data`, sacrificing existing activity FK compatibility for a simpler future-facing event model.
- Shared domain schemas for activity payload validation and frontend-safe parsing, including `import_summary` payload kind for bulk import events.
- API activity logging helpers, expense mutation services, member/invitation/group mutation services, and notification dispatch abstraction.
- Generic differ framework (`activity-diff`) and concrete differs for both expense (10 fields) and group (3 fields + linkedParticipant) change detection, supporting both coarse field lists and per-field before/after display strings.
- Web activity feed rendering and translations for new activity event types and per-field change detail display.
- Email delivery helpers for expense and bulk-import-summary notifications, including centralized real-email and active-member recipient filtering.
- Tests for activity rows, expense recipient selection, skipped recipients, non-blocking email failures, migration behavior, differ units, and web activity rendering.
