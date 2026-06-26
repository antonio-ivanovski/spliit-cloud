# Handoff: Invitation Model Refactor

## Goal

Refactor group invitations so the codebase no longer treats `GroupInvitation.email` as the invitation's only identity, display label, and authorization mechanism. This is a foundation change for future invite types, including generated invite URLs and email-less account flows, but this handoff should focus on preserving today's email invite behavior while making the model and API easier to extend.

## Non-Goals

- Do not add generated invite URLs in this change.
- Do not add Reddit sign-in in this change.
- Do not make `Account.email` nullable in this change unless a separate auth handoff explicitly scopes that work.
- Do not change existing email invite product behavior: email invites still require the accepting account's email to match the invitation email.

## Why This Refactor Is Needed

Today email is overloaded across the invitation system:

- `GroupInvitation.email` is the invite target.
- The same email is used as the pending invitee display name.
- `loadGroupViewer` grants pending read access by matching `ctx.auth.user.email`.
- `acceptInvitation` and `declineInvitation` authorize by comparing account email to invitation email.
- Pending invite ledger participants recover their display label through the invitation email.

That coupling makes link invites and email-less accounts hard to add without fragile special cases. The refactor should separate these concepts:

- invite target,
- invite display label,
- invite acceptance authorization,
- ledger participant label resolution.

## Current State

- Invitation schema: `GroupInvitation.email String`.
- Pending invitees are materialized as virtual `LedgerParticipant` rows so expenses can be assigned before acceptance.
- Pending invite labels in participants, expenses, exports, and activities commonly fall back to `invitation.email`.
- Email invites are surfaced in-app by `listPendingInvitationsForAccount(accountEmail)`.
- Pending group read access is allowed by `loadGroupViewer({ accountEmail })`.

## Recommended Data Model Refactor

Introduce enough structure to support multiple invite target kinds while keeping email invites fully compatible.

Suggested schema direction:

- Add enum `GroupInvitationType`:
  - `EMAIL`
  - `LINK`
- Add `type GroupInvitationType @default(EMAIL)` to `GroupInvitation`.
- Keep `email String` for this refactor if minimizing migration blast radius is preferred.
- Or change `email String?` only if the same migration also adds conditional validation for `EMAIL` rows.
- Add `displayName String?` or `temporaryName String?`.
  - Prefer `temporaryName` if the product language is "temporary invitee name".
  - Use it as a pending-only label; accepted account profile wins after acceptance.

Recommended incremental approach:

1. Add `type` with default `EMAIL`.
2. Add `temporaryName String?`.
3. Backfill existing rows with `type = EMAIL`.
4. Keep all existing email indexes and behavior.
5. Add helper functions so callers stop reading `invitation.email` directly for display names.

Do not add token fields in this handoff unless the agent is intentionally combining it with the link-invite handoff.

## API Refactor

Keep tRPC procedures thin. Move invite-specific branching and label logic into `apps/api/src/lib/invitations.ts`.

Add focused helpers:

- `getInvitationDisplayName(invitation)`
  - for accepted invite: caller should prefer account name when available,
  - for pending invite: `temporaryName ?? email ?? 'Pending invite'`.
- `assertCanAcceptEmailInvitation(invitation, accountEmail)`
  - preserves current email-match behavior.
- `assertCanDeclineEmailInvitation(invitation, accountEmail)`
  - preserves current email-match behavior.
- `createEmailInvitation(...)`
  - owns normalization, duplicate checks, and email-specific validation.
- `listPendingEmailInvitationsForAccount(accountEmail)`
  - makes the email-specific nature explicit.

Refactor existing exports rather than breaking all callers at once:

- Existing `createInvitation` can delegate to `createEmailInvitation`.
- Existing `acceptInvitation` can remain but should read as "accept email invitation" internally.
- Existing `declineInvitation` can remain but should read as "decline email invitation" internally.

## Group Viewer Refactor

`loadGroupViewer` currently falls back to pending invitations by matching account email. Keep this behavior, but make the constraint explicit:

- Rename internal lookup/commenting to "pending email invitation".
- Guard the lookup if account email is missing in the future.
- Return a viewer shape that can later carry invite type:

```ts
type GroupViewer =
  | { kind: 'ACTIVE' }
  | {
      kind: 'PENDING_INVITEE'
      invitation: { id: string; role: string; type: 'EMAIL' | 'LINK' }
    }
```

For this handoff, only `EMAIL` pending viewers need to resolve.

## Pending Participant and Label Refactor

Update participant materialization and label resolution so display does not directly depend on email.

Places to check:

- pending participant materialization in `getGroup`,
- expense `paidBy` / `paidFor` label resolution,
- activity actor label resolution,
- exports that display participant names,
- members page pending invitation list.

Expected label priority:

1. accepted account name,
2. pending invitation temporary name,
3. pending invitation email,
4. generic label such as `Pending invite`.

This preserves current behavior for email invites while making link invites straightforward later.

## Web Refactor

Keep UI behavior unchanged for users.

Recommended changes:

- Rename local form types/functions from generic "invitation" to "email invitation" where helpful.
- Ensure pending invitation UI can render an invitation label from API data instead of assuming email is always the primary label.
- Keep the email input form and pending email invite list working exactly as today.
- Do not add link-invite tabs or token routes in this handoff.

## Tests

Add or update tests around behavior that must remain unchanged:

- creating an email invite normalizes email,
- duplicate pending email invite is rejected,
- existing member email cannot be invited,
- email invite can be accepted by matching account email,
- email invite cannot be accepted by non-matching account email,
- pending invite participant label is email when no temporary name exists,
- pending invite participant label is temporary name when present,
- revoked/historical pending invite label still resolves.

## Verification

Run:

```bash
bun prisma-generate
bun check-types
bun run test
```

Run `bun check-formatting` if the touched files include formatting-sensitive generated or message output.

## Follow-On Handoffs

- Add single-use generated invite URLs and temporary invite names as a separate handoff.
- Add Reddit sign-in and email-less account support as a separate handoff.

## Code References

- Invitation model: `packages/db/prisma/schema.prisma`
- Invitation business logic: `apps/api/src/lib/invitations.ts`
- Group participant materialization and display names: `apps/api/src/lib/api.ts`
- Group viewer pending email access: `apps/api/src/trpc/init.ts`
- Invitation router: `apps/api/src/trpc/routers/invitations/index.ts`
- Members/invite UI: `apps/web/src/app/groups/[groupId]/members/members.tsx`
- Group invite banner: `apps/web/src/app/groups/[groupId]/group-header.tsx`
- Recent pending invites UI: `apps/web/src/app/groups/recent-group-list.tsx`
