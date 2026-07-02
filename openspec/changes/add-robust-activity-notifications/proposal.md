## Why

Spliit currently records only a small set of coarse activity events, so important group, invitation, member, and expense changes are either missing from the user-facing activity timeline or rendered as generic group updates. Expense changes also do not notify affected active participants, which makes edits and deletions easy to miss.

## What Changes

- Expand activity events into a richer, user-facing timeline for group settings, archive state, invitations, member lifecycle, role changes, and expense create/update/delete.
- Store activity payloads as typed JSON with Zod-backed schemas and a discriminated union shared between API and web.
- Migrate existing activity enum values to clearer event names:
  - `CREATE_EXPENSE` -> `EXPENSE_CREATED`
  - `UPDATE_EXPENSE` -> `EXPENSE_UPDATED`
  - `DELETE_EXPENSE` -> `EXPENSE_DELETED`
  - `UPDATE_GROUP` -> `GROUP_UPDATED`
- Add lightweight expense diff summaries for activity display and email copy, covering changed fields such as title, amount, date, category, notes, payers, split, items, documents, and recurrence.
- Send immediate expense email notifications after the domain mutation commits, without failing the action if delivery fails.
- Deliver expense emails only to affected active, accepted, account-backed group members, excluding the actor.
- Skip email delivery for pending invitees, unlinked participants, left/removed members, placeholder emails, and all invitation/member/group events in this first pass.
- Introduce a notification dispatcher abstraction that can later be backed by durable `NotificationDelivery` rows and retry processing without changing mutation call sites.

## Capabilities

### New Capabilities

- `activity-notifications`: Immediate notification dispatch for activity events, initially limited to expense email notifications for eligible affected participants.

### Modified Capabilities

- `activities`: Activity events become richer typed timeline events with structured JSON payloads and expanded event types.
- `expenses`: Expense create/update/delete mutations record structured activity and trigger immediate eligible-recipient email notifications.
- `group-membership`: Membership and invitation lifecycle changes record user-facing activity events, and activity visibility remains limited to currently authorized group viewers.

## Impact

- Prisma schema and migration for `Activity.activityType` enum values and typed JSON `Activity.data`.
- Shared domain schemas for activity payload validation and frontend-safe parsing.
- API activity logging helpers, expense mutation services, member/invitation/group mutation services, and notification dispatch abstraction.
- Web activity feed rendering and translations for new activity event types and lightweight changed-field summaries.
- Email delivery helpers for expense notifications, including centralized real-email and active-member recipient filtering.
- Tests for activity rows, expense recipient selection, skipped recipients, non-blocking email failures, migration behavior, and web activity rendering.
