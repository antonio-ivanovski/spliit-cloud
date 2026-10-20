# Invite links: completed review and implementation

Updated 2026-10-20. Scope: reusable invitation links, count/expiry limits, authentication return paths, explicit acceptance across authentication, and Effect integration. The follow-up contract below supersedes the earlier automatic-on-read behavior.

## Product contract

- Shared links admit multiple accounts as MEMBERs. Defaults are unlimited joins and seven-day expiry; explicit unlimited and never-expiring options remain available.
- Concrete limits are 2–1000 joins and 1 hour–365 days. Labels are trimmed and limited to 40 characters.
- Opening an invitation is read-only, including for signed-in sessions. Explicit Accept joins immediately; Sign in to accept carries `invitationAction=accept` through every auth/setup hop and then joins. The action travels in email callbacks and works across devices. View-only credentials never become acceptance intent.
- Successful acceptance verifies active membership, refreshes account/invitation/group caches, removes invite credentials and the action explicitly (including retained router params), and replaces navigation with group expenses. Failed acceptance retains context for deliberate retry.
- Shared rotation changes credentials only; it preserves count, cap, label, and expiry. QR rotation retains its separate fresh-session policy. Revocation disables the credential.
- Ten unrevoked PENDING shared links may exist per group. Expired/full links still occupy a slot until revoked; this bounds retained credentials and allows intentional revival by editing limits.

## Completed task list

### 1. Current-cap enforcement — complete

The claim compares `useCount` against the current `maxUses` column inside the atomic update. It no longer embeds a cap read before a lock wait. Count, membership, ledger reconciliation, activity, and notification planning remain in the same transaction.

Proof: deterministic real-database row-lock cases cover concurrent cap reduction, increase, and removal. A final-slot race admits exactly one account. The original reduction regression failed before repair with `useCount=3, maxUses=2` and passes after repair without creating membership/activity.

### 2. Bind explicit acceptance to the requested group — complete

Both link and personal-email acceptance mutation inputs accept `expectedGroupId` and verify the invitation belongs to that group before writing. Group preview reads perform no acceptance. Existing member reads cannot consume another group’s token.

Proof: real-DB cases reject wrong-destination link and personal-email mutations without membership or token consumption. Session and OAuth preview reads remain side-effect free.

### 3. Preserve concurrent expiry edits during rotation — complete

Shared rotation omits `expiresAt` from its update. Single-use refresh and QR reset semantics remain intact.

Proof: a real transaction holds an expiry shortening while rotation waits; after release, the shortened expiry survives. This regression failed before repair by restoring the stale seven-day date.

### 4. Preserve actionable failures — complete

Acceptance mutations preserve typed domain failures and infrastructure errors. The shared controller only settles a failed mutation as success after an authoritative read proves active membership (a concurrent acceptance). Otherwise it displays the failure and retains credentials for deliberate retry. Onboarding status failures block commands and provide retry. Rate-limited responses retain `Retry-After`.

Proof: removed/suspended accounts can preview but cannot accept or consume another use. Existing endpoint tests distinguish missing resources from database failures.

### 5. Complete the client lifecycle after explicit acceptance — complete

`groups.get` is read-only; `joinedViaInvite` is retired. One shared controller owns manual and post-auth acceptance, in-flight deduplication, membership verification, cache invalidation, and token/action cleanup. It explicitly clears retained search fields; `search: {}` alone allowed the parent router middleware to restore `invite` in a live browser regression.

Proof: browser journeys cover manual Accept, signed-in preview/reload without joining, and automatic completion only after Sign in to accept. Hook tests cover manual and post-auth personal-email dispatch (prioritized over sibling link proof), authoritative onboarding, StrictMode, failure/retry, and already-active membership without another mutation.

### 6. Refresh the actual profile session cookie — complete

HTTP profile updates use Better Auth as the single authoritative write path and forward its cookies. Internal callers deliberately retain the Prisma path. The redundant preliminary Prisma write was removed. The global cookie cache remains at its original five-minute TTL.

Proof: real HTTP integration creates a signed session, primes the cached session cookie, updates the profile, applies Set-Cookie, and reads the new name immediately with cookie caching enabled. An injected authenticated-write failure leaves the profile unchanged.

### 7. Repair the Effect failure contract — complete

The repository adapter classifies known invitation failures into the expected channel and treats unknown infrastructure faults as defects. The misleading `cause as never` cast is gone. Legacy email validation failures are deliberately adapted to the domain vocabulary, preserving their messages.

Proof: endpoint tests distinguish missing resources from database failures; the latter remain internal errors. No test-only lifting helper was exported.

### 8. Retain the recovery lifecycle regression — complete

The existing recovery test now runs with root React Strict Mode and proves a usable recovery panel with one setup POST despite callback identity churn. A distinct offline→online test proves stale requests cannot complete the replacement lifecycle. The latest-callback ref remains; the broken one-shot setup guard remains removed.

Proof: the root Strict Mode reproduction failed with the old guard in an isolated scratch copy during review and passes on the repaired implementation.

### 9. Strengthen auth-return and browser coverage — complete

Structured returns carry `invite`, `viewKey`, `invitation`, and `invitationAction` at every hop. Bounded legacy flattening merges credentials from all intermediate hops with outer/explicit precedence. Raw bearer logging is removed. The intermediate-token regression failed before repair and passes afterward. ProfileGate also restores the leading `#` omitted by TanStack’s decoded location hash; otherwise the fragment corrupts the final query value (invite token or acceptance action). The gate regression failed before repair and now covers both query orders.

Password, passkey, anonymous creation/recovery, magic-link, and social callbacks use the shared complete-profile destination. All completed SDK sign-ins reload into that same gate, which bootstraps the new cookie session before protected navigation. This discards stale in-process query and identity state rather than racing it against the new session. Browser magic-link completion uses another context to prove cross-device action/proof delivery. Provider-boundary unit tests cover social continuation and invite-bearing callbacks; an external OIDC roundtrip is unavailable because `auth.example.com` does not resolve.

### 10. Improve E2E reliability — complete

Optional update-modal handling reads actual announcement eligibility, then uses observable visible/dismissed/persisted outcomes. It no longer relies on ignored `isVisible` timeouts or swallowed transport failures. The recovery POST listener attaches before signup and asserts exactly one request. Unused probes and fixture-only navigation were removed. One bounded observation remains specifically for the routing-loop contract.

### 11. Use Effect at real operation boundaries — complete

Create, preview, accept, update, rotate, and copy now have traced Effect operations with production repository/token dependencies. Promise exports remain compatibility adapters for existing callers. The Prisma repository owns complete invariant-bearing transactions; individual writes were not split into independently committed effects.

Stateless layers are provided at the boundary. No ManagedRuntime was added because these services own no reusable resources or shutdown lifetime. Layer construction is lazy at the compatibility boundary to avoid module initialization cycles.

### 12. Consolidate Effect vocabulary, time, and constants — complete

- Built-in Effect Clock supplies live time to persistence operations; TestClock exercises real expiry behavior. The unused custom clock was removed.
- Token generation is effectful, service identifiers are namespaced, and unused deterministic test-token scaffolding was removed.
- Browser-safe bounds/defaults live in `@spliit/domain/invitations`.
- Ended reasons are a literal schema union. Domain errors import no tRPC code; one exhaustive transport adapter maps them and preserves causes.
- The faulty unused `isLinkLive` helper, redundant cap predicate, unused error aliases/re-exports, and trivial framework-composition tests were removed.

### 13. Align policy and release copy — complete

API omission now matches the existing UI default of unlimited joins. The quota constant explicitly names pending links, including ended ones. Release notes describe the completed shared-link feature and auth-return fix without overlapping entries. The existing migration is preserved; these review fixes require no additional migration.

No message files were hand-edited. The earlier changed-string audit found all 31 locales complete.

### 14. Validation record

Previous review validation remains historical. Follow-up validation on 2026-10-20:

- API focused unit suites: 234 passed across seven files.
- Web affected suites: 312 tests passed across fifteen files. Duplicate dialog setup tests were removed after moving unique cases to the complete-profile owner.
- Database integration: 63 passed across shared links, single-use links, QR sessions, and profile/session HTTP behavior.
- Scoped API/web formatting, lint, and type check: seven tasks passed. Documentation formatting and `git diff --check` passed.
- Browser verification passed anonymous signup plus recovery, cross-device magic-link signup, password signup plus later sign-in, signed-in preview/reload without joining, manual Accept, and real virtual-authenticator passkey registration/sign-in.
- Final production-preview run: 12 passed (11 browser journeys plus fresh setup), with retries disabled. It includes anonymous creation/recovery, cross-device email callbacks, password signup/sign-in, and real virtual-authenticator passkey registration/sign-in, alongside auth/group neighbors. Generated service-worker assets are exercised.

The late-friends-response UI regression failed before repair by moving Invite link back to Friends. Selecting a tab now prevents a later default-selection effect from overriding it. Test setup uses observable UI sign-out (including the anonymous confirmation) and waits for its final document load rather than treating an interim signed-out panel or cookie clearing as session completion. Redacted diagnostics established HTTP 429 on session reads during repeated local runs. Invitation-test contexts now simulate independent visitors through unique trusted-proxy IPs at the browser network boundary; real API responses, authentication, and database writes remain exercised, with production rate limits unchanged. Final browser validation uses a fresh setup account, one worker, and no retries.

Web unit runs emit happy-dom aborted-fetch/connection diagnostics during teardown but complete with exit status zero; no failed test is excluded.

## Onboarding and offline-download repair

Anonymous creation now always leaves the sign-in dialog for the complete-profile route. The duplicate dialog name/safeguard implementation was removed: a production browser run demonstrated the dialog being replaced by ProfileGate after typing, losing the entered name. The single-owner regression failed before repair. Existing complete-profile tests own name validation, offline behavior, save failures, recovery choice, and passkey setup; unique rename/failure cases were moved there and duplicate dialog tests/mocks were removed.

OfflineSyncHost waits for a usable display name and authoritative anonymous setup completion before launching downloads or flushing pending writes. The sync verifier and manual retry also enforce setup readiness. `ANONYMOUS_SETUP_REQUIRED` stops an already-started pass quietly without persisting a failed-download state, and later completion resumes work.

The lifecycle invalidates public query memory when moving from signed-out to signed-in, while same-account refresh preserves cached results. Account refetch forwards freshness options to Better Auth and publishes the refreshed lifecycle identity before resolving. Tests use a real QueryClient and lifecycle to prove preview eviction and immediate renamed profile visibility.

Anonymous browser coverage observes requests and DOM changes throughout setup, asserting no premature catalog request and no “Downloads need updating” toast. This fixes an application onboarding race; no development service-worker configuration change was needed.

## Additional defect found during implementation

Both shared and single-use acceptance could pass an expiry comparison made before waiting on a row lock, then join after the deadline. Acceptance now rechecks the deadline after the locked claim, before membership/activity writes; an expired claim rolls back.

Proof: TestClock advances exactly to the deadline while a real database write is blocked. Both regressions failed by successfully joining before repair, and now return the typed expiry error with no membership or use consumed.

## Remarks and future improvements

- The join velocity limiter remains process-local best effort, consistent with the repository's other fixed-window limiters. Global multi-instance throttling would require a shared limiter; the lifetime join cap already has database enforcement.
- Explicit acceptance is a mutation shared across auth methods. The URL action conveys workflow intent only; server-side credentials, ownership, target group, capacity, expiry, and membership restrictions remain authoritative.
- Shared copy-anytime credentials are intentionally stored in plaintext. They are returned only through authorized create/copy/rotate surfaces, omitted from invitation lists, and cleared on revoke. Encryption at rest would be a separate storage/key-lifecycle feature.
- Promise-based Prisma transaction aggregates are intentional. Converting every individual query to Effect would add machinery without improving transaction ownership; future compositions can use the existing service boundary.
- The quota counts retained pending credentials rather than currently usable links. Changing it to a live-only quota would also require serialization around revival edits, not just a different count query.
- No changes were committed, published, or deployed. Neighboring working-tree changes were preserved; no stashes or resets were used.

## Complete re-review on 2026-10-20

Reviewed the invitation create/edit/copy/rotate/revoke and acceptance paths, Effect services/repositories/error boundaries, auth-return schemas/builders and sign-in methods, profile/safeguard routing, session/cache lifecycle, offline readiness, and their test coverage again.

Fixed findings:

- **One-time-link membership restriction bypass:** shared links rejected removed/suspended accounts, while one-time links reactivated them. One-time acceptance now checks membership in its transaction before writing; rejection rolls back the claimed invitation. The existing real-database restriction table now covers both kinds and both statuses. Both one-time cases failed by joining before the repair.
- **Personal invitation discovered only after authentication:** following a link while signed out could lead to an authenticated personal-invitation conflict. The completion owner now uses the authenticated group's EMAIL invitation when completing a link target, preserving the invitation's ledger participant. Explicit personal invitation IDs remain authoritative. The controller regression failed by dispatching the link mutation before repair.
- **Obsolete completion after navigation:** one hook-wide pending Promise let a different group inherit the old completion; the earlier request could redeem its token and redirect back. In-flight work now belongs to the committed identity/group/credential/action scope. Cleanup fences subsequent writes, cache work, and navigation; each scope deduplicates its own request. A request already sent to the server may finish, but its stale continuation cannot redirect the current page. The regression failed by accepting/navigating the first group before repair.
- **Stale email authorization during concurrent edits:** email acceptance read the recipient/status before opening its transaction and could overwrite a concurrent revocation or accept for the former recipient after retargeting. It now locks the invitation row, then reads and validates the recipient, group, type, and pending state inside the same transaction as membership/activity writes. Both real-row-lock regressions failed by joining before repair and now preserve the committed revocation/retarget without membership or acceptance activity.
- **Outdated friend-ledger test:** the neighboring database suite still required membership writes from groups.get. Its existing test now proves cookie and read-scoped OAuth previews remain read-only, followed by explicit acceptance with the correct role and friend-pair key.

No additional Effect rewrite was needed: the current stateless service layers, explicit Clock/token dependencies, typed domain failures, defect handling for infrastructure faults, and Prisma transaction ownership remain appropriate. No new resource-owning service was added that would warrant a ManagedRuntime lifecycle.

Re-review validation: 270 web unit tests across eleven suites and 234 API unit tests across seven suites passed; 97 database tests across shared/single-use/QR/friend invitations and profile sessions passed. Scoped API/web check passed all seven formatting/lint/type tasks. Production-preview browser verification passed all 12 tests (fresh setup plus eleven journeys), one worker and retries disabled. It covered anonymous setup/recovery, cross-device email, password signup/sign-in, real virtual-authenticator passkeys, explicit signed-in confirmation, credential cleanup, reload, and auth/group neighbors. The initial sandboxed attempt could not launch Chromium due to macOS Mach-port permissions; the authorized run outside the sandbox passed. API services remained user-managed; browser journeys used the existing API, and backend repairs were exercised directly from the current checkout by database createCaller tests. Live OIDC remains unavailable because the configured provider hostname does not resolve. Release notes and this record were formatted, and git diff --check passed.

## Effect completeness re-review on 2026-10-20

Reviewed the shared/link invitation Effect operations, Promise adapters, domain/transport error mapping, crypto and Clock dependencies, personal email completion, auth-return controller, and onboarding/offline download handoff against the installed Effect 4 documentation and source.

### Repairs

- **Email completion bypassed the Effect boundary.** Acceptance and decline now expose traced `acceptInvitationEffect` / `declineInvitationEffect` programs, with Promise compatibility adapters in `email-completion.ts`. Both run through `InvitationRepository`, which retains expected tagged domain failures and treats unknown infrastructure failures as defects. `email-repository.ts` owns each complete Prisma transaction, including ledger reconciliation, activities, and notification planning. Email acceptance receives the captured Effect Clock through the existing Prisma clock bridge; membership and acceptance timestamps no longer read an unrelated wall clock. A real-database TestClock contract verifies both persisted timestamps.
- **Two competing error models.** The email module's `InvitationError extends TRPCError` is removed. Email guards now share the existing domain validation error with links and pending updates. This also removes the repository's special transport-error-to-domain-error adapter. Invitation router middleware remains the transport translation owner. Existing router authorization/error tests pass through this boundary.
- **Decline used stale authorization.** Like the previously repaired acceptance path, decline could validate a pending invitation, wait for a conflicting write, then overwrite a revocation or decline an invitation reassigned to a different recipient. Decline now locks the row before reading status/type/recipient inside the write transaction. The existing real-lock race table covers both completion operations. Both new decline cases failed before repair by completing successfully and now preserve the prior committed edit with no decline/acceptance activity.
- **Offline best-effort callbacks actually killed fibers.** `notify` used `Effect.matchEffect(Effect.sync(fn))`: callback throws became defects, bypassing its failure handler. It now uses `Effect.try` and ignores only that expected callback failure. The connectivity recovery table independently covers a throwing connectivity listener and throwing broadcast listener. Both failed before repair with their thrown errors; both now reach a completed download and committed snapshot after reconnect.

### Deliberate boundaries

- React and TanStack retain component ownership, route fencing, mutation state, and navigation. Auth-return parsing stays a pure bounded local-URL transformation; it does not need a runtime or a service.
- Prisma retains complete transactional aggregates. Individual queries are not wrapped into separately executed Effect programs, and Effect interruption is not advertised as cancelling an underlying Prisma transaction.
- Service layers remain stateless and acquire no owned resources. A global ManagedRuntime and shutdown lifecycle would add no resource safety here. The current per-operation runner remains appropriate.
- Platform crypto failures and unexpected storage/database defects are not turned into ordinary invitation validation failures. Only the documented best-effort notification callback is intentionally ignored.
- Email creation/delivery, revocation, and broader account/offline lifecycle retain their existing Promise APIs outside this completion boundary; this pass does not claim a repository-wide Effect conversion.

### Verification

- `bun run check --filter=@spliit/web --filter=@spliit/api`: all 7 tasks pass (formatting, lint, types and required generation).
- Affected web units: 272 passed across 11 files; API invitation/auth/account/group units: 234 passed across 7 files. Total: **506 units**.
- Current-checkout database suites: shared links, one-time links, QR invitations, friend ledgers, and profile sessions: **100 passed across 5 files**.
- Failed-before evidence: `/tmp/invite-effect-decline-red.txt` (2 stale-decline failures), `/tmp/invite-effect-notify-red.txt` (2 callback defects). Passing results: `/tmp/invite-effect-db-final.txt`, `/tmp/invite-effect-api-final.txt`, `/tmp/invite-effect-web-final.txt`, `/tmp/invite-effect-check.txt`.
- No API service was restarted. Browser journeys were not rerun in this pass; the preceding 12 production-preview browser results remain historical, not evidence of the new backend code. The current backend changes are exercised by direct database integration tests, and token preservation/auth-return neighbors were rerun as unit tests. Live OIDC remains unavailable in the configured environment.
