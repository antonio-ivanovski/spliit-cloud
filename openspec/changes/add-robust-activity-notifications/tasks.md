## 1. Schema, Migration, And Generated Types

- [ ] 1.1 Add `prisma-json-types-generator` as a Bun dev dependency and add the Prisma `generator json` block, because activity payloads must be strongly typed at Prisma boundaries instead of remaining untyped `JsonValue`.
- [ ] 1.2 Change `Activity.data` in `packages/db/prisma/schema.prisma` from `String?` to nullable typed `Json?` with the `/// [ActivityData]` AST annotation, because the design requires a real JSON field from the start while keeping legacy/null rows readable.
- [ ] 1.3 Expand and rename the Prisma `ActivityType` enum to `EXPENSE_CREATED`, `EXPENSE_UPDATED`, `EXPENSE_DELETED`, `GROUP_UPDATED`, `GROUP_ARCHIVED`, `GROUP_UNARCHIVED`, `INVITATION_CREATED`, `INVITATION_REVOKED`, `INVITATION_ACCEPTED`, `INVITATION_DECLINED`, `MEMBER_LEFT`, `MEMBER_REMOVED`, and `MEMBER_ROLE_CHANGED`, because downstream rendering and notification routing must not depend on ad hoc string markers.
- [ ] 1.4 Create a migration that renames existing enum values and converts existing `Activity.data` string values into pragmatic JSON payloads or null, because old activity rows are low-value but must not break reads after the column type changes.
- [ ] 1.5 Add the global `PrismaJson.ActivityData` type declaration in the db package TypeScript config scope, because the JSON generator needs a stable type name for the annotated Prisma field.
- [ ] 1.6 Run `bun prisma-generate` and update generated Prisma client artifacts, because the repo intentionally commits generated client changes after schema updates.
- [ ] 1.7 Add migration-level or API-level regression coverage for migrated enum names and nullable JSON activity payload reads, because enum renames are high-risk for generated-client and fixture breakage.

## 2. Shared Domain Activity Payload Schemas

- [ ] 2.1 Add activity data Zod schemas in `packages/domain` using `z.discriminatedUnion('kind', ...)`, because the API writes payloads and the web renders them from the same contract.
- [ ] 2.2 Define the expense activity payload schema with compact metadata for title, amount, currency code, date, summary, and changed fields, because expense emails and timeline entries need lightweight context without exact share-delta accounting.
- [ ] 2.3 Define group, member, and invitation activity payload schemas with display-oriented metadata only, because the activity feed is informational and should avoid exposing raw internal identifiers where a display label exists.
- [ ] 2.4 Export inferred TypeScript types for the activity payload union and each specialized payload, because Prisma typed JSON, API logging helpers, and web rendering need stable compile-time types.
- [ ] 2.5 Add domain unit tests for valid payloads, invalid discriminators, nullable legacy payload handling helpers, and representative changed-field payloads, because runtime Zod validation remains the source of truth even with Prisma JSON typing.

## 3. Activity Logging API Refactor

- [ ] 3.1 Update `apps/api/src/lib/api/activities.ts` so `logActivity` accepts typed JSON data and returns the created activity row, because post-commit notification dispatch needs the stable `activityId`.
- [ ] 3.2 Add helper builders for expense, group, member, and invitation activity payloads, because write sites should not duplicate schema shape or accidentally serialize invalid JSON.
- [ ] 3.3 Update `getActivities` to parse payloads through the shared schema and return either parsed data or a safe null/fallback state, because the web activity feed must not fail on old or malformed rows.
- [ ] 3.4 Preserve actor resolution through ledger participant and account identity, and add a safe fallback actor label path, because some activities can have an account actor even when no ledger participant resolves.
- [ ] 3.5 Update existing API tests that assert old activity enum names or string `data`, because the new event taxonomy and JSON payload shape are intentional contract changes.

## 4. Expense Diff And Affected Participant Utilities

- [ ] 4.1 Add a utility that extracts affected ledger participant IDs from paid-by, paid-for, item paid-for, and itemized remainder data, because notification recipients are defined as the union of all payer and split references.
- [ ] 4.2 Ensure the affected-participant utility supports create with only new expense data, delete with only old expense data, and update with old plus new data, because removed-from-expense active members still need update notifications.
- [ ] 4.3 Add a lightweight expense diff utility that reports only field groups `title`, `amount`, `date`, `category`, `notes`, `payers`, `split`, `items`, `documents`, and `recurrence`, because the chosen user experience is simple summaries rather than exact value-level audit.
- [ ] 4.4 Normalize participant/share lists, document IDs/URLs, and itemized structures before comparison, because the diff should detect meaningful changes without being brittle to ordering or object shape noise.
- [ ] 4.5 Add focused unit tests for affected participants and changed-field summaries, including documents changed, itemized data changed, payer-only changes, split-only changes, and participant removed from an updated expense.

## 5. Expense Activity Writes

- [ ] 5.1 Update `createExpense` to write `EXPENSE_CREATED` activity with actor identity, expense ID, and lightweight expense metadata in the same committed operation as the expense creation where practical, because activity must match committed domain data.
- [ ] 5.2 Update `updateExpense` to load the old expense state, compute changed fields, write `EXPENSE_UPDATED` activity with typed payload, and return post-commit notification context, because update emails and timeline summaries need both old and new state.
- [ ] 5.3 Update `deleteExpense` to capture metadata and affected participants before deleting, write `EXPENSE_DELETED` activity with typed payload, and return post-commit notification context, because delete emails cannot query the deleted expense afterward.
- [ ] 5.4 Ensure S3 document cleanup remains outside any unsafe rollback-sensitive path and does not prevent activity payload generation, because notification/activity changes must not regress existing document lifecycle behavior.
- [ ] 5.5 Add API tests for expense create/update/delete activity rows, typed payload content, changed fields, and atomicity expectations, because these are the core user-visible audit events.

## 6. Member, Invitation, Group, And Archive Activity Writes

- [ ] 6.1 Update group settings changes to write `GROUP_UPDATED` with lightweight changed-field metadata, because generic settings changes should be visible without overloading member/invite events.
- [ ] 6.2 Update group archive and unarchive flows to write `GROUP_ARCHIVED` and `GROUP_UNARCHIVED`, including force-archive settlement paths, because archive state is a group-level lifecycle event.
- [ ] 6.3 Update member leave, member removal, and member role update flows to write `MEMBER_LEFT`, `MEMBER_REMOVED`, and `MEMBER_ROLE_CHANGED` with actor and target display metadata, because these were previously hidden or collapsed into generic group updates.
- [ ] 6.4 Update email invitation and link invitation creation to write `INVITATION_CREATED` with display label, type, and role, because admins and pending invitees should see the local timeline even though no invite email notification is part of this change.
- [ ] 6.5 Update invitation revoke, accept, and decline flows to write `INVITATION_REVOKED`, `INVITATION_ACCEPTED`, and `INVITATION_DECLINED`, because invitation lifecycle changes are part of the activity feed and acceptance intentionally does not create a separate member-joined event.
- [ ] 6.6 Ensure all new non-expense activity writes use typed payload builders and do not trigger email dispatch, because the first pass explicitly suppresses group/member/invitation emails.
- [ ] 6.7 Add API/router tests for member, invitation, group update, archive, and unarchive activity rows, including pending invite visibility and revoked invite access denial where existing helpers allow it.

## 7. Notification Dispatcher Abstraction

- [ ] 7.1 Create an `ActivityNotificationDispatcher` interface and event type containing `activityId`, `activityType`, `groupId`, `actorAccountId`, and event-specific metadata, because future durable delivery records need this stable event identity.
- [ ] 7.2 Implement a `CompositeActivityNotificationDispatcher`, because future channels or a durable `NotificationDelivery` writer should compose behind the same mutation-facing API.
- [ ] 7.3 Implement a local fire-and-log scheduling helper that dispatches on a later loop turn and catches errors with `console.warn`, because the mutation must return after commit without waiting for successful email delivery.
- [ ] 7.4 Wire expense mutation procedures or service return paths to call the dispatcher only after the domain mutation has committed, because sending email inside the transaction can notify users about rolled-back changes.
- [ ] 7.5 Add tests using a fake dispatcher to prove dispatch is requested for expense create/update/delete and not requested for group, member, invitation, or archive events.

## 8. Expense Email Delivery

- [ ] 8.1 Implement `ExpenseEmailActivityNotificationDispatcher` that handles only `EXPENSE_CREATED`, `EXPENSE_UPDATED`, and `EXPENSE_DELETED`, because non-expense activity emails are explicitly out of scope.
- [ ] 8.2 Add recipient resolution through `LedgerParticipant -> GroupMember(status ACTIVE) -> Account`, excluding the actor and non-account-backed participants, because eligibility is current active accepted group membership, not historical expense presence alone.
- [ ] 8.3 Reuse or centralize `isPlaceholderEmail` in a deliverable-email guard, because placeholder addresses must never leak into SMTP delivery paths.
- [ ] 8.4 Ensure pending invitees, link invitations, unlinked imported participants, left members, removed members, and admins who are not affected participants are skipped, because the chosen model is affected active accepted participants only.
- [ ] 8.5 Build branded email subjects such as `[Spliit Cloud] <expense> was updated in <group>` and bodies with actor, group, expense title, light amount/date metadata, changed fields for updates, and the best available expense/group/app link.
- [ ] 8.6 Use the existing `sendEmail` helper and catch/log delivery failures without throwing, because first-pass delivery is immediate but non-blocking and not yet durable.
- [ ] 8.7 Add tests for successful create/update/delete emails, actor exclusion, pending invite skip, unlinked skip, left/removed skip, placeholder skip, active removed-from-expense update recipient inclusion, and delivery failure non-blocking behavior.

## 9. Activity Feed Web Rendering

- [ ] 9.1 Update the web activity item type mapping to include all new activity enum values, because the feed currently handles only four legacy values.
- [ ] 9.2 Parse and render typed activity payloads in the activity feed, using changed fields for expense updates and display labels for member/invitation events, because the timeline should be friendly and light.
- [ ] 9.3 Add safe fallback rendering for null or invalid activity payloads, because migrated or malformed rows must not break the activity page.
- [ ] 9.4 Add English source translations for all new activity messages and changed-field labels using the i18n CLI workflow, because messages files must not be hand-edited outside the established translation process.
- [ ] 9.5 Audit non-English locales with `bun i18n check --changes-only` and translate newly introduced keys using the translate-strings skill if required, because locale sync is a CI gate in this repo.
- [ ] 9.6 Add React component tests for rendering expense created/updated/deleted, group archived/unarchived, invitation created/revoked/accepted/declined, member left/removed/role changed, and invalid-payload fallback states.

## 10. Authorization And Visibility Verification

- [ ] 10.1 Verify activity list authorization still grants active members access and pending invitees read-only access, because pending invitees should see activity while their invitation is pending.
- [ ] 10.2 Verify left, removed, revoked, and non-member accounts cannot read group activity, because activity visibility must follow current group access only.
- [ ] 10.3 Add or update integration/router tests for pending invitee activity access and revoked/removed access denial, because activity feed visibility is security-sensitive.
- [ ] 10.4 Confirm archived groups still return activities to active members, because archive state should not hide historical activity.

## 11. End-To-End Test And Quality Gates

- [ ] 11.1 Run `bun check-types` after schema, generated types, API, and web updates, because enum renames and typed JSON will surface cross-package type failures.
- [ ] 11.2 Run focused API unit tests for activities, expenses, members, invitations, and notification dispatch, because most behavior is server-side and should not require a dev server.
- [ ] 11.3 Run focused web component tests for the activity feed, because new rendering branches and translations are user-facing.
- [ ] 11.4 Run `bun run test` once focused tests pass, because default mock-based tests catch cross-package regressions without needing the integration server.
- [ ] 11.5 Run `bun i18n check` after translation work, because locale sync is a canonical CI gate.
- [ ] 11.6 Do not run E2E tests for this change unless explicitly requested, because project guidance marks Playwright E2E as broken.
- [ ] 11.7 Do not start the dev server for integration tests without explicit user permission, because project guidance requires an existing API server for web integration tests.

## 12. Final Review And Handoff

- [ ] 12.1 Review all activity write paths for transaction boundaries, because activities must be committed with domain changes while notifications dispatch after commit.
- [ ] 12.2 Review all email recipient paths for placeholder, pending, unlinked, left, removed, and actor exclusions, because recipient leakage is the highest-risk product/privacy failure.
- [ ] 12.3 Review dispatcher boundaries to ensure mutation call sites do not call email helpers directly, because the abstraction must remain compatible with future durable delivery and retry workers.
- [ ] 12.4 Review migration output and generated Prisma client changes together, because schema, generated code, and migration must be committed as one unit.
- [ ] 12.5 Produce a concise implementation summary mapping completed work back to the OpenSpec scenarios, because this change is likely to be split across subagents and needs an integration-oriented handoff.
