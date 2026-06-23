## Context

The current app is a group-first, anonymous-access system:

- `Group` owns `Participant`, `Expense`, `Activity`, and group settings in `packages/db/prisma/schema.prisma`.
- `Participant` is only `{ id, name, groupId }`; it is not an account and has no global identity.
- API context in `apps/api/src/trpc/init.ts` returns `{}` and all current tRPC procedures are effectively unauthenticated.
- Export routes and upload presign routes are mounted directly in `apps/api/src/server.ts` and currently authorize by possession of route parameters or no account context.
- The web app stores recent groups, starred groups, archived groups, active participant, and default split settings in browser `localStorage`; the account-backed product should replace group discovery and active participant state with server data.
- Expense and balance math in `packages/domain` is mostly identifier-agnostic, but schemas and API orchestration assume group-local participant IDs.

This change is the foundation for the roadmap. It must replace anonymous app access with authenticated account access while preserving the core Spliit money rules: integer minor units for amounts, basis points for percentage splits, and balance behavior.

## Goals / Non-Goals

**Goals:**

- Add authenticated accounts with magic link, Google OAuth, and email/password sign-in. Password login is email-based; username-only password login is out of scope.
- Make online server data the source of truth for cloud groups, memberships, expenses, activities, documents, and settings.
- Model new native group participants as account-backed group members.
- Add explicit invitation and membership flows for adding accounts to groups.
- Introduce `Ledger` as the accounting core behind every group from day one.
- Replace local recents and active participant selection with account session and server-backed membership data.
- Protect tRPC procedures, export routes, and upload presign routes with account and membership authorization.
- Keep the design greenfield-friendly: legacy data contracts may be replaced rather than carefully preserved.

**Non-Goals:**

- Migrating every existing anonymous production group without import tooling. That belongs to `import-spliit-groups`.
- Designing direct account-to-account expenses. That belongs to `add-direct-account-expenses`.
- Building the account overview dashboard. That belongs to `add-overview-homepage`.
- Choosing final UI copy, email templates, or exact OAuth provider setup.
- Supporting unauthenticated app users.

## Decisions

### 1. Use account-backed memberships for native cloud groups

Replace the current `Participant` concept for new native cloud groups with `GroupMember` rows that point to an `Account`.

Recommended model shape:

- `Account`: stable global user identity.
- `AuthIdentity`: provider identity records for email/password, magic-link email, and Google.
- `Session`: server-recognized session state for the web client.
- `Group`: cloud group metadata and settings.
- `GroupMember`: account membership in a group, with display name snapshot/override, role, status, and timestamps.
- `GroupInvitation`: invite records for email or account-targeted invitations.

Expense relations for native cloud groups should point to ledger participant IDs rather than raw account IDs:

- `Expense.paidByLedgerParticipantId`.
- `ExpensePaidFor.ledgerParticipantId`.

Rationale: a membership is the account's identity inside that group. It can carry role, status, display name, joined/left state, and historical visibility without overloading global account identity.

Alternatives considered:

- Keep `Participant` and add optional `accountId`: easier migration, but it preserves anonymous-participant ambiguity and makes new native groups accidentally allow unauthenticated participants.
- Point expenses directly at `Account`: simpler schema, but loses group-specific membership lifecycle and makes historical group leave/removal behavior harder.

### 2. Treat member status as lifecycle, not deletion

Group members should have a status enum such as `PENDING`, `ACTIVE`, `LEFT`, `REMOVED`, and possibly `SUSPENDED`.

New native group expenses can only use `ACTIVE` members. Historical expenses keep references to members that have left or been removed. Removing a member should revoke access and prevent future selection, but should not delete historical paid-by or paid-for rows.

Rationale: historical ledgers must remain auditable after people leave groups.

Alternatives considered:

- Cascade delete members: breaks expense history.
- Keep a boolean `isActive`: insufficient for invites, leaving, removal, and moderation/audit cases.

### 3. Use role-based membership authorization

At minimum, group roles should include:

- `OWNER`: can delete group, transfer ownership, manage all members and settings.
- `ADMIN`: can invite/remove non-owners, edit settings, manage expenses.
- `MEMBER`: can view group and manage allowed expenses.

The first group creator becomes `OWNER`. Every group must always have at least one owner. Export and upload routes must validate membership and role before serving data or creating presigned URLs.

Rationale: possession of a group ID should no longer be authorization.

Alternatives considered:

- Single member role: simpler, but invites/removal/settings become all-or-nothing.
- Capability-permission table from day one: flexible, but too heavy for the current roadmap.

### 4. Put authentication in API context and split public/protected procedures

`createTRPCContext` should parse the request session and return:

- `session`: nullable session data.
- `account`: nullable account profile.
- `requireAccount()`: helper or protected middleware.

Add procedure helpers:

- `publicProcedure`: public reads/actions such as health, feature flags, and auth entry points if exposed through tRPC.
- `protectedProcedure`: requires a signed-in account.
- `groupProcedure`: requires group membership and places `group`, `member`, and role data in context.

Rationale: existing routers are thin and procedure-oriented. Authorization should be centralized, not repeated by each resolver.

Alternatives considered:

- Authorize inside `apps/api/src/lib/api.ts` only: easy to miss on new procedures and external routes.
- Put all auth behind Hono middleware only: useful for routes, but tRPC still needs typed account context.

### 5. Use server sessions with secure cookies for the SPA

The web app should use secure, HTTP-only session cookies with CORS credentials. The client should not store bearer tokens in localStorage.

Rationale: the current app already uses browser-origin CORS with credentials enabled. HTTP-only cookies reduce token exposure and fit web-only first delivery.

Alternatives considered:

- Store JWT access tokens in localStorage: straightforward for SPA calls, but exposes auth tokens to XSS.
- Pure stateless JWT cookies: simpler infrastructure, but revocation and account lifecycle controls become harder.

### 6. Keep auth provider implementation behind a local auth module

Introduce an API-side auth module, for example `apps/api/src/lib/auth/`, that owns provider integration, password hashing, magic-link tokens, OAuth callback handling, session issuance, and account linking rules. The product should not leak a third-party auth package's schema into domain code.

Rationale: provider choice can change, but the rest of the app should depend on local concepts: `Account`, `Session`, `AuthIdentity`, and `GroupMember`.

Alternatives considered:

- Build fully custom auth: maximum control, but higher security burden.
- Use a provider/library schema everywhere: fastest start, but makes later schema and runtime changes harder.

### 7. Browser storage is not a group source of truth

Replace current localStorage group ownership semantics with server-backed membership and account preference state. The client may retain non-authoritative UI preferences, but group membership, active user identity, starred/archived group state, and group access must come from the server.

Server-backed account state should cover:

- Groups the account can access.
- Group role and membership status.
- Account-level group preferences such as starred, archived, pinned, or hidden.
- Signed-in account identity for expense forms.
- Any default split/form preferences that should follow the account across devices.

Current `localStorage` keys may be discarded because this is a greenfield account-backed product.

Rationale: browser storage must not define group access or participant identity.

Alternatives considered:

- Keep recent groups and active participant in localStorage: conflicts with online source of truth.

### 8. Introduce `Ledger` as the accounting core

The current implementation uses `Group` as both the product container and the accounting container: `Expense` has `groupId`, `Activity` has `groupId`, participants are group-local, and balances are calculated from group expenses.

The new model should split these responsibilities:

- `Group`: product container for group name, settings, membership, roles, invitations, and group-specific navigation.
- `Ledger`: accounting container for expenses, paid-for rows, balances, activities, documents, recurrence, exports, and base currency.
- `LedgerParticipant`: a party that can appear in expenses and balances.

Every group, including imported groups, SHALL have one ledger from creation. Future direct account relationships SHALL also have one ledger, without creating a group row.

Rationale: this gives direct account expenses the same balance and expense logic as groups without creating hidden groups or duplicating expense tables.

Alternatives considered:

- Keep expenses attached directly to groups: simplest for current behavior, but direct expenses would require duplicated tables or hidden groups.
- Use hidden groups for direct account relationships: reuses group logic but leaks group semantics into direct relationships.

### 9. Put base currency on the ledger

The current currency behavior is:

- `Group.currency` and `Group.currencyCode` define the group display/base currency.
- `Expense.amount` stores the normalized amount in group minor units.
- `Expense.originalAmount`, `originalCurrency`, and `conversionRate` optionally preserve the entered currency and conversion used.
- The web can fetch Frankfurter rates for a date and allows custom positive conversion rates.
- Custom group currencies have no automatic conversion.

The ledger model should keep these rules but move the base currency to `Ledger`:

- `Ledger.currency` and `Ledger.currencyCode` define the ledger base currency.
- `Expense.amount` stores the normalized amount in ledger minor units.
- `Expense.originalAmount`, `originalCurrency`, and `conversionRate` preserve the entered currency and conversion used when different from the ledger currency.
- Split amounts for `BY_AMOUNT` are stored in ledger minor units.
- `BY_PERCENTAGE` remains basis points out of `10000`.
- Direct ledgers must choose a base currency at creation, using a smart default from account preference or locale while allowing manual override.

Rationale: currency belongs to the accounting container. Moving it to `Ledger` lets groups and direct relationships share conversion, exports, and balance math.

Alternatives considered:

- Keep currency on `Group` only: direct ledgers would need a duplicate currency model.
- Store every amount in original currency only: makes balances expensive and ambiguous.
- Convert balances dynamically at display time: exchange rates change and would make historical balances unstable.

### 10. Preserve domain math by normalizing identities at the boundary

Domain balance and totals functions should continue receiving participant-like identifiers, but callers should pass `LedgerParticipant` identifiers. Rename domain types from participant-oriented names only when it reduces confusion.

Rationale: the math does not care whether an identifier belongs to a member-like party. Avoid rewriting stable money math unnecessarily.

Alternatives considered:

- Rewrite domain math around accounts: unnecessary and risks changing split behavior.
- Keep participant naming everywhere: technically possible but misleading after accounts become required.

## Risks / Trade-offs

- [Risk] Auth implementation mistakes can expose account or group data. -> Mitigate with centralized auth middleware, route-level tests, secure cookies, password hashing review, and explicit authorization helpers.
- [Risk] Greenfield schema changes can invalidate current E2E fixtures and local workflows. -> Mitigate by updating tests alongside schema work and accepting a clean migration path for local/dev data.
- [Risk] Group membership removal can break historical calculations if modeled as deletion. -> Mitigate with member status lifecycle and no cascade deletion from expenses to historical members.
- [Risk] Magic-link and password auth introduce email deliverability and security operations work. -> Mitigate with environment validation, rate limits, token expiry, and provider-agnostic auth module.
- [Risk] Export/upload routes may be forgotten because they are not tRPC procedures. -> Mitigate by adding Hono auth middleware and tests for route authorization.

## Migration Plan

1. Add auth/account/membership schema in `packages/db/prisma/schema.prisma` and create a migration.
2. Run `bun prisma-generate` and update public Prisma imports through `@spliit/db`.
3. Implement API auth context and protected procedure helpers.
4. Convert groups router procedures to require membership authorization.
5. Update group creation to create the current account as owner/member.
6. Add `Ledger` and `LedgerParticipant` schema and attach every group to a ledger.
7. Convert native group expense paid-by and paid-for relations from participant IDs to ledger participant IDs.
8. Move group currency semantics to ledger currency semantics.
9. Update domain schemas and web forms to use ledger participant IDs.
10. Replace local recent/active group behavior with server-backed group list, account preferences, and signed-in account state.
11. Protect export and upload routes.
12. Update Playwright helpers and unit tests for authenticated setup.
13. Remove or quarantine legacy anonymous access code paths.

Rollback strategy: because this is greenfield and breaking, rollback should be operational rather than data-preserving. Keep the migration boundary clear, deploy behind an auth/account feature flag while under development, and avoid mixing legacy anonymous writes with account-backed writes in the same production environment.

## Open Questions

- Which auth implementation/library will be used under the local auth module?
- What exact role permissions should `MEMBER` have for editing expenses created by others?
- Can members leave groups themselves, and what happens if the last owner tries to leave?
- Should account deletion anonymize historical group display names or block deletion until ownership/membership is resolved?
- Are email addresses visible to other group members as secondary identity text when needed, or only in invite/account management screens?
- Should invite acceptance require exact email match or allow the invitee to link/claim with a different account after confirmation?
