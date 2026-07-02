## Context

Activities are currently stored on `Activity` rows attached to a Ledger, with a small Prisma `ActivityType` enum and an optional string `data` field. The API already logs expense create/update/delete events and some member/group events, but many user-visible actions are missing or are collapsed into `UPDATE_GROUP` with ad hoc string markers. The web activity feed renders only four event types and treats `data` as display text.

Expense mutations already have enough information to identify old and new expense participants. The notification requirement is intentionally narrower than a full notification system: send immediate expense emails to affected active accepted members only, while keeping the code path compatible with a future durable delivery table and retry worker.

## Goals / Non-Goals

**Goals:**

- Record a friendly, lightweight activity timeline for expense, group, invitation, and member lifecycle changes.
- Replace string activity payloads with typed JSON backed by shared Zod schemas and Prisma typed JSON field support.
- Replace specialized activity columns with a generic event-log shape using code-defined typed strings and migrate existing activity type values to clearer names.
- Add expense email notifications for affected active account-backed participants, excluding the actor.
- Skip email for pending invitees, unlinked participants, placeholder emails, left/removed members, and all non-expense events in this first pass.
- Ensure notification delivery happens after transaction commit and cannot fail the domain action.
- Keep a clean path to add `NotificationDelivery` rows and retry processing later.

**Non-Goals:**

- Building account notification preferences in this change.
- Adding durable notification delivery persistence or retry workers now.
- Sending email for invitation, group, member, archive, or role-change events.
- Creating legal-grade audit history or exact per-recipient share-delta accounting.
- Granting activity visibility to left or removed members.

## Decisions

### 1. Use structured typed JSON for activity data

Change `Activity.data` from `String?` to `Json?` and type it with `prisma-json-types-generator`. The Prisma schema field should use an AST comment such as:

```prisma
/// [ActivityData]
data Json?
```

Add a generated-client JSON type declaration that defines `PrismaJson.ActivityData` from the shared domain activity data type. Prisma's typed JSON support is external-generator based: add the `prisma-json-types-generator` generator to `schema.prisma`, add the AST comment, and define the global `PrismaJson` namespace in a TS declaration included by the package config. The runtime schema remains Zod-backed; typed Prisma JSON gives compile-time safety at persistence boundaries.

The field remains nullable so old rows and sparse events can be handled without backfilling every historical payload.

Alternative considered: keep `data` as JSON-encoded `String`. That avoids a migration and generator, but keeps the persistence model weak and makes accidental invalid payloads easier.

### 2. Put activity payload schemas in `packages/domain`

Define activity payload schemas in the domain package because the API writes events and the web renders them. Use a Zod discriminated union:

```ts
activityDataSchema = z.discriminatedUnion('kind', [
  expenseActivityDataSchema,
  groupActivityDataSchema,
  memberActivityDataSchema,
  invitationActivityDataSchema,
])
```

The payload should stay render-oriented and compact:

- `kind`
- `summary`
- `changedFields`
- `expense` metadata: title, amount, currency code, date
- `member` metadata: display name, previous role, next role
- `invitation` metadata: display label, type, role

Activity type values are code-defined string literals validated by a shared Zod schema, not a Prisma/database enum. The database stores them in a string column for lighter future additions/removals, while code keeps type safety and validation at read/write boundaries. The JSON payload provides details for display and notification copy.

Alternative considered: make each event a different table. That is unnecessary for a friendly timeline and would make the first pass too heavy.

### 3. Simplify Activity into a generic typed event log

Replace specialized activity columns with a generic event-log shape. The database should stop modeling event-specific relations such as `accountId`, `ledgerParticipantId`, and `expenseId` on the `Activity` table. Those relationships are useful for the current narrow timeline, but they do not fit group, member, invitation, direct ledger, push, Telegram, or future integration events consistently.

Use typed strings and typed JSON instead:

The Prisma model should follow this shape:

```prisma
model Activity {
  id       String   @id
  ledger   Ledger   @relation(fields: [ledgerId], references: [id], onDelete: Cascade)
  ledgerId String
  time     DateTime @default(now())

  /// ![ActivityType]
  type String

  /// ![ActivityActorType]
  actorType String?
  actorId   String?

  /// ![ActivitySubjectType]
  subjectType String?
  subjectId   String?

  /// [ActivityData]
  data Json?

  @@index([ledgerId, time])
  @@index([ledgerId, type, time])
  @@index([subjectType, subjectId])
}
```

Use `prisma-json-types-generator` string-field support for each typed string. Prisma documents this advanced string-field typing with an AST comment such as `/// !['draft' | 'published']`; for Spliit, do not manually list values inline in the Prisma schema. Instead, expose externally provided `PrismaJson` types inferred from domain Zod schemas, similar to `ActivityData`, and link the string fields to those types.

Define the supported values in `packages/domain` as Zod enums or literal unions and export inferred TypeScript types. In the Prisma JSON/string type declaration file, expose reusable types from the domain schemas:

```ts
declare global {
  namespace PrismaJson {
    type ActivityType = ActivityTypeFromDomainSchema
    type ActivityActorType = ActivityActorTypeFromDomainSchema
    type ActivitySubjectType = ActivitySubjectTypeFromDomainSchema
    type ActivityData = ActivityDataFromDomainSchema
  }
}
```

The exact imports/type aliases should follow the repo package boundaries, but all three activity string types must be inferred from the same Zod schemas that validate activity records at runtime. This keeps the Prisma schema compact and prevents manual drift between inline unions and domain schemas.

The activity record should be interpreted as:

- `type`: what happened, such as `EXPENSE_UPDATED` or `INVITATION_REVOKED`.
- `actorType`/`actorId`: who caused it, such as `ACCOUNT:user_123`, `LEDGER_PARTICIPANT:lp_123`, or `SYSTEM`.
- `subjectType`/`subjectId`: what it happened to, such as `EXPENSE:exp_123`, `MEMBER:gm_123`, `INVITATION:inv_123`, or `GROUP:grp_123`.
- `data`: display and notification payload.

This deliberately sacrifices DB-level foreign keys from activities to accounts, ledger participants, and expenses. Activities are historical messages and notification triggers, not the accounting source of truth. Deleted or inaccessible subjects should still leave readable historical activity through copied display metadata in `data`.

Migrate existing string values to:

- `EXPENSE_CREATED`
- `EXPENSE_UPDATED`
- `EXPENSE_DELETED`
- `GROUP_UPDATED`

Add new code-defined event values:

- `GROUP_ARCHIVED`
- `GROUP_UNARCHIVED`
- `INVITATION_CREATED`
- `INVITATION_REVOKED`
- `INVITATION_ACCEPTED`
- `INVITATION_DECLINED`
- `MEMBER_LEFT`
- `MEMBER_REMOVED`
- `MEMBER_ROLE_CHANGED`

Invitation acceptance should create `INVITATION_ACCEPTED`, not a separate `MEMBER_JOINED` event. A future direct-add/admin-add flow can introduce `MEMBER_JOINED` if it needs distinct semantics.

No database enum should remain for activity event, actor, or subject types. This intentionally makes future event additions/removals a domain schema and Prisma-client-generation change rather than a database enum migration.

Alternatives considered:

- Keep the Prisma enum and only add values. That gives database-level constraints, but each taxonomy change requires schema migration and generated-client churn for a user-facing timeline where code-defined validation is sufficient.
- Keep `accountId`, `ledgerParticipantId`, and `expenseId` relations on `Activity`. That preserves convenient joins for current expense rows but keeps member, invitation, direct-ledger, and future notification events awkward.

### 4. Activity writes happen with the domain mutation

Activity rows should be written inside the same transaction as the domain change whenever the domain mutation uses a transaction. This guarantees the timeline matches committed data.

The activity logging helper should accept `type`, optional actor, optional subject, and typed `data`, then return the created activity including its `id`. Post-commit notification dispatch should reference this stable event identifier. When a mutation needs notification dispatch, the service should return enough post-commit context to dispatch after the transaction completes.

Alternative considered: write activity after commit together with notifications. That risks missing timeline events if notification code throws or the process exits after the domain write.

### 5. Dispatch notifications asynchronously after commit

Do not send emails inside the database transaction. After the mutation commits, enqueue dispatch into the next loop turn with an abstraction such as:

```ts
interface ActivityNotificationDispatcher {
  dispatch(event: ActivityNotificationEvent): Promise<void>
}
```

Use a small composer so future implementations can be added without changing mutation call sites:

```ts
class CompositeActivityNotificationDispatcher
class ExpenseEmailActivityNotificationDispatcher
```

The first implementation can schedule dispatch with a local fire-and-log helper, for example `queueMicrotask` plus an async wrapper or a `setTimeout(..., 0)` wrapper. It must catch errors and `console.warn`; mutation responses must not await successful delivery. The method boundary should pass the created activity event or a normalized event envelope containing `activityId`, `type`, `groupId`, actor, subject, and event-specific metadata so a later durable dispatcher can create `NotificationDelivery` rows before sending.

Alternative considered: directly call `sendEmail` from expense services. That is faster to implement but makes future retry/delivery persistence harder and couples mutation logic to email details.

### 6. Expense recipients are affected active accepted members only

For expense create/update/delete, compute affected participant IDs from the union of old and new payer/split/item/remainder participant references:

- `paidByList`
- `paidFor`
- `items[].paidFor`
- `itemizedRemainder.paidFor`

For create, the old side is empty. For delete, the new side is empty. For update, include both old and new so someone removed from an expense can still be notified if they are currently an active member.

Resolve recipients through `LedgerParticipant -> GroupMember -> Account` and require:

- `GroupMember.status === ACTIVE`
- account-backed ledger participant
- recipient account is not the actor
- account email is present and not a placeholder email

Admins have no special notification status; they are notified only if they are affected expense participants.

Pending invitees do not receive email, even if the expense references their pending ledger participant. Left or removed members do not receive email, even if they were historically part of the expense.

Alternative considered: notify every historical participant on the expense. That can email users who no longer have group access, which conflicts with the chosen access model.

### 7. Keep expense diffs lightweight

Expense update activity and email copy should list changed field groups rather than exact value-level deltas. The supported changed-field keys are:

- `title`
- `amount`
- `date`
- `category`
- `notes`
- `payers`
- `split`
- `items`
- `documents`
- `recurrence`

Comparison should normalize simple structures before comparing, especially payer/split participant-share lists and documents. It does not need to calculate exact per-user share deltas.

Expense emails include light metadata: group name, actor name, expense title, amount, date, changed fields for updates, and a relevant link. Subjects should be clearly branded, for example:

```text
[Spliit Cloud] Dinner was updated in Trip
```

Email bodies should always include the most relevant available link: expense link when the expense still exists, otherwise group link or app link for deleted expenses.

Alternative considered: exact before/after diffs for every field. That is heavier to maintain and not required for a friendly user timeline.

### 8. Keep activity visibility tied to current group access

Current active members can view group activity. Pending invitees can view group activity while their invitation is pending and they have read-only group access. Left, removed, revoked, or otherwise unauthorized accounts cannot view group activity. Archived groups still show activity to active members.

This should be enforced by existing group/activity authorization paths rather than by filtering individual activity rows per viewer.

### 9. Render known activity types, fall back safely

The web activity feed should render by `type`, using parsed `Activity.data` for display details. Known event types get explicit translated messages. If payload parsing fails or older rows have null payloads, render a safe generic message rather than failing the activity feed.

Invitation activity should prefer `temporaryName` or a simple display label. Avoid showing raw email unless there is no better label.

## Risks / Trade-offs

- [Risk] Typed JSON generator adds a new dev dependency and generated-client behavior. -> Keep the runtime Zod schema as the true validation boundary and add tests around Prisma JSON typing/imports.
- [Risk] Fire-and-log asynchronous dispatch can drop emails if the process exits right after commit. -> Accept for first pass; the dispatcher interface is shaped so a future durable `NotificationDelivery` implementation can replace it.
- [Risk] Activity rows can be committed but email dispatch can fail. -> Log failures with `console.warn`; this is intentional and avoids blocking user actions.
- [Risk] Expense diff summaries may be imprecise. -> Keep copy explicitly lightweight and field-group based.
- [Risk] Removing event-specific foreign keys can make actor/subject display harder after deletion. -> Copy display metadata needed for the friendly timeline into typed `data` at write time.
- [Risk] Removing database enums and relation-backed type constraints allows invalid strings if writes bypass application code. -> Validate activity event, actor, and subject types through shared domain schemas at all API write boundaries, type Prisma string fields through externally provided generator types, and parse/fallback safely on reads.
- [Risk] Pending invitees can see activity while pending. -> Existing authorization must revoke access immediately when invitation status changes.

## Migration Plan

1. Add `prisma-json-types-generator` to dev dependencies and add the generator to `packages/db/prisma/schema.prisma`.
2. Replace `Activity.activityType` with `Activity.type` as typed `String` using `/// ![ActivityType]`.
3. Add nullable typed string actor fields: `actorType` with `/// ![ActivityActorType]` and `actorId`.
4. Add nullable typed string subject fields: `subjectType` with `/// ![ActivitySubjectType]` and `subjectId`.
5. Change `Activity.data` to nullable `Json` with the `ActivityData` typed JSON annotation.
6. Drop specialized activity columns after data has been copied: `accountId`, `ledgerParticipantId`, and `expenseId`.
7. Migrate existing activity type string values:
   - `CREATE_EXPENSE` to `EXPENSE_CREATED`
   - `UPDATE_EXPENSE` to `EXPENSE_UPDATED`
   - `DELETE_EXPENSE` to `EXPENSE_DELETED`
   - `UPDATE_GROUP` to `GROUP_UPDATED`
8. Convert existing activity relations and string `data` values pragmatically:
   - copy existing `accountId` into `actorType = ACCOUNT`, `actorId = accountId`
   - copy existing `ledgerParticipantId` into actor metadata only when no account actor is present, or preserve it in `data` when useful for display
   - copy existing `expenseId` into `subjectType = EXPENSE`, `subjectId = expenseId`
   - expense rows can store a minimal expense payload using the previous string as title/summary when present
   - generic group rows can keep `data = null` or a minimal group payload
9. Run `bun prisma-generate`.
10. Update domain schemas, API writers, web renderers, and tests in one implementation pass.

Rollback strategy: because the generic event-log migration drops specialized columns, rollback would require reconstructing `accountId`, `ledgerParticipantId`, and `expenseId` from actor/subject/data where possible. This is intentionally lossy. Prefer forward-fixing rendering/dispatch issues over rolling back after writes in the new format.

## Open Questions

- None for the initial implementation scope.
