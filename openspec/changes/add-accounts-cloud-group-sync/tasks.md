## 1. Backend Data Model

- [ ] 1.1 [Backend] Design and migrate Prisma models for `Account`, `AuthIdentity`, `Session`, `GroupMember`, `GroupInvitation`, `Ledger`, and `LedgerParticipant` in `packages/db/prisma/schema.prisma`.
- [ ] 1.2 [Backend] Move group base-currency fields to `Ledger` while preserving `currency`, `currencyCode`, `Expense.amount`, `originalAmount`, `originalCurrency`, and `conversionRate` semantics.
- [ ] 1.3 [Backend] Add one `Ledger` for every group creation path and ensure group expenses, activities, documents, recurrence, exports, and balances attach to the group ledger.
- [ ] 1.4 [Backend] Convert expense paid-by and paid-for relations from group-local participant IDs to `LedgerParticipant` IDs.
- [ ] 1.5 [Backend] Add server-side account group preferences for pinned/starred/archived/hidden group state where needed by group lists and overview.

## 2. Backend Auth And Authorization

- [ ] 2.1 [Backend] Implement local auth module for magic link, Google OAuth, and email+password sign-in with verified-email identity merging.
- [ ] 2.2 [Backend] Add secure server session creation, lookup, and invalidation; expose authenticated account in `createTRPCContext`.
- [ ] 2.3 [Backend] Add `publicProcedure`, `protectedProcedure`, and group/ledger authorization helpers for tRPC routers.
- [ ] 2.4 [Backend] Protect all group tRPC procedures with membership and role checks.
- [ ] 2.5 [Backend] Protect export routes and upload presign routes with authenticated ledger access checks.
- [ ] 2.6 [Backend] Implement group invitation create, accept, revoke, and list procedures with exact-email acceptance.

## 3. Backend Domain And API Refactor

- [ ] 3.1 [Backend] Update `apps/api/src/lib/api.ts` group and expense operations to create and use `Ledger` and `LedgerParticipant` records.
- [ ] 3.2 [Backend] Update group, expense, balance, stats, activity, export, and upload routers to use ledger IDs internally while preserving group-facing route/API behavior.
- [ ] 3.3 [Backend] Update `packages/domain` schemas/types to accept ledger participant IDs and preserve existing split math units.
- [ ] 3.4 [Backend] Add account profile and membership list procedures for web session bootstrap and member management.

## 4. Frontend Integration

- [ ] 4.1 [Frontend] Add auth client/session bootstrap and route guards for protected app routes.
- [ ] 4.2 [Frontend] Replace recent/active group localStorage behavior with server-backed group membership, account preferences, and current account identity.
- [ ] 4.3 [Frontend] Update group create/edit forms to invite/select authenticated members instead of creating anonymous participants.
- [ ] 4.4 [Frontend] Update expense forms and group views to use ledger participant IDs and account-backed display data.
- [ ] 4.5 [Frontend] Update export and document-upload calls to send ledger/group context required for authorization.

## 5. UI-Focused Handoff

- [ ] 5.1 [UI] Design sign-in/sign-up screens for magic link, Google OAuth, and email+password without username-only login.
- [ ] 5.2 [UI] Design authenticated account shell states: signed out, loading session, signed in, and unauthorized group access.
- [ ] 5.3 [UI] Design group member management UI for owners/admins, including roles, invitations, pending invites, and member status.
- [ ] 5.4 [UI] Design account display patterns: display name primary, email secondary only in invite/account-management contexts.
- [ ] 5.5 [UI] Design ledger-currency controls for group creation/editing using the existing currency selector behavior.

## 6. Verification

- [ ] 6.1 [Testing] Add unit tests for ledger currency conversion rules, split unit preservation, and ledger balance inputs in `packages/domain`.
- [ ] 6.2 [Testing] Add API tests or integration coverage for auth context, protected procedures, membership authorization, export authorization, and upload authorization.
- [ ] 6.3 [Testing] Update Playwright helpers to create authenticated accounts, groups, members, and expenses.
- [ ] 6.4 [Testing] Run `bun prisma-generate`, `bun check-types`, `bun run test`, and targeted Playwright specs for auth/group/expense flows.
