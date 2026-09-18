# Phase 2 — dependable offline reading

Goal: After automatic downloading completes, an existing account can close Spliit, disconnect, reopen the PWA or browser, and read every member group, every expense, and balances without network access. Interrupted refreshes, account transitions, and reconnects must not corrupt data, expose another account's data, lose the last complete download, or silently queue changes.

Status: ready to implement. This document is the implementation source of truth; no feature implementation has been performed.

## Requirements and decisions

- [Decided — user] Download **all member groups**, not only recently opened groups or loaded query pages.
- [Decided — user] Core coverage: group overview, group expense lists, expense details, balances, global expense list. Registered and anonymous accounts; exclude link-only visitors.
- [Decided — user] Download automatically whenever the app is open online, including mobile data. Retain downloads until cleared or signed out; no time-based expiry.
- [Decided — user, latest instruction] Prioritize reliable core behavior. Extras get basic support. **Ordinary offline search replaces the earlier request for fuzzy-search parity.** Do not implement a PostgreSQL trigram clone.
- [Decided — architecture] IndexedDB is the durable read repository; TanStack Query remains the network/query lifecycle layer. Explicit read adapters select network or downloaded data. Do not persist the entire QueryClient or intercept/cache tRPC HTTP responses in the service worker.
- [Decided — handoff defaults] Active, archived, hidden, and FRIEND groups are included when membership is ACTIVE. Hidden/archived display preferences still apply. Normal browser and installed PWA behave identically.
- [Decided — handoff defaults] Full coherent snapshot per group; one group download at a time; atomic replacement; no partial snapshot is readable. Account-wide snapshots need not share one database timestamp.
- [Decided — handoff defaults] Reuse existing server DTOs/calculation functions; add two internal authenticated read procedures for catalog/snapshot downloading. No new database tables or Prisma migration for this phase.
- [Constraint] Bun only. Do not start dev servers, compose, API, preview servers, or other long-lived services without explicit user authorization. Web integration needs an existing API on :3001; ask if unavailable. API createCaller integration needs DB only.
- [Constraint] Money is integer cents; percentage shares are integer basis points. Preserve Date values, expense versions, original currency/amount, conversion metadata, split modes, item allocations, removed participants, and recurrence metadata.
- [Constraint] No offline creates/edits/deletes, outbox, mutation persistence/replay, Background Sync, receipt binary downloading, offline group creation, or automatic conflict resolution.
- [Constraint] No new install requirement, onboarding modal, mandatory storage-permission prompt, or blocking download screen.
- [Assumption] A complete group snapshot is a practical transfer unit for current deployments. Validate the explicit large-data fixture below before declaring completion; this is not a measured repository fact.

## Verified current state

- Inspection date: 2026-09-17. Working tree was clean before this handoff. No tests, builds, browser checks, or service launches were run during planning; current runtime correctness is not established.
- `apps/web/vite.config.ts`: VitePWA injectManifest; precaches HTML, JS, CSS, fonts, locale JSON and icons; excludes large HEIC codec; development service worker disabled.
- `apps/web/src/sw.ts`: complete app-shell precache/navigation fallback; coordinated activation and push handling. Preserve the update protocol and `pwa-update-*` protections.
- `apps/web/src/trpc/client.tsx`: singleton QueryClient and tRPC client; httpBatchLink with SuperJSON and credentialed trackedFetch; ordinary QueryClientProvider. No durable group/expense store.
- `apps/web/src/trpc/query-client.ts`: 30-second staleTime; dehydration can include pending queries. This is **not** suitable as a durable offline persistence policy.
- `apps/web/src/lib/use-current-account.ts`, `last-account.ts`: last account metadata in localStorage; fallback during pending/error session resolution. Not a credential. Multiple consumers currently trigger snapshot effects.
- `apps/web/src/lib/connectivity.ts`, `use-online-status.ts`, `network-error.ts`: navigator status plus failed-fetch latch. Any resolved HTTP fetch currently clears the latch. No central recovery/auth-verification state machine.
- `apps/web/src/components/require-auth.tsx`: allows saved account shell access; permits group-view URL credentials; shows offline empty state without an account.
- `apps/web/src/components/account-menu.tsx`: successful sign-out clears last account and QueryClient. Does not clear a durable store or coordinate other tabs.
- `apps/web/src/components/offline-banner.tsx`: uses `OfflineBanner.message`; current English message incorrectly implies changes can be saved after reconnecting.
- `apps/web/src/AppShell.tsx`: TRPCProvider wraps account preference sync, saved-view merge, PWA guards, mascot, and route content. Automatic mutations exist outside visible submit buttons.
- Core consumers: `app/groups/recent-group-list.tsx`, `app/groups/[groupId]/layout.client.tsx`, `expenses/expense-list.tsx`, `expenses/expense-preview-modal.tsx`, `expenses/edit-expense-form.tsx`, `balances/balances-and-settlements.tsx`, `app/expenses/page.tsx` under `apps/web/src/`.
- Group context: `app/groups/[groupId]/current-group-context.tsx`; read-only currently reflects public/pending-invitation access, not offline state. Do not mislabel an offline member as an invitee.
- API sources: `apps/api/src/trpc/routers/overview/index.ts`, `groups/get.procedure.ts`, `groups/expenses/{list,get}.procedure.ts`, `groups/balances/list.procedure.ts`, `expenses/index.ts`; DTO schemas in `apps/api/src/trpc/outputs/`.
- `groups.list({ groupIds: [] })` discovers ACTIVE memberships. Overview includes both MEMBER and VIEW_ONLY entries, with view keys on saved views: never persist its raw response indiscriminately.
- Group lists use offset/involvement cursors; global lists use opaque sort cursors. Neither is a durable snapshot protocol.
- `apps/api/src/lib/api/expenses/queries.ts`: list/detail loaders use global Prisma, not an injected transaction. Detail loading issues previous/next recurrence queries per expense. Do not call this loader once per expense during a bulk download.
- `groups.get` can accept a FRIEND invitation when a link token is supplied. Snapshot reads must be strictly membership-only and must not invoke this side-effectful path.
- Existing group/global filters differ: group currency filters match `originalCurrency`; global currency filters match group base currency. Group sort ties remain descending; global ties follow sort direction.
- Creation already uses idempotency support; updates require `expectedVersion`. Phase 3 must use these and include basic conflict detection rather than postponing all conflict handling to Phase 4.

## Fixed behavior contract

### Coverage matrix

| Surface | Offline contract |
| --- | --- |
| Home/group overview | All catalog member groups; downloaded groups show stored summaries; missing downloads show status, not invented zero balances. |
| Group expenses | Complete stored history, local pagination, involvement collapse, structured filters, basic search and sorting. |
| Expense preview/direct URL | Complete stored detail, splits, notes, items, currency/conversion and recurrence metadata; previous/next stored occurrence navigation. |
| Group balances | Exact stored server result, including individual/subgroup settlement plans and currency balances; record-settlement actions disabled. |
| Global expenses | Union of complete downloaded member groups with existing hidden/archive defaults; disclose missing groups. |
| Group information | Render metadata already in snapshot; no additional download dependency. |
| Receipt images/files and avatars | Attachment metadata/count available, attachment opening/downloading disabled; stable initials/placeholders for remote images. Never imply files are downloaded. |
| Comments/activity/statistics/budgets/members administration/reports/exports/AI/imports | Connection-required state. Do not launch their network queries while offline; do not promise persisted data. |
| Account settings | Offline download controls and local appearance/locale controls usable; remote settings visibly unavailable. |
| Create/edit routes | Explicit read-only/connection-required state and navigation back; no editable expense form initialized from a stale snapshot. |
| Public links/saved views/pending invitations | Existing online behavior; connection-required offline. No credential-scoped persistence in this phase. |

“Ready offline” means a validated snapshot transaction committed, not that a request finished or data appeared on screen. First-use offline without a prior shell/data download cannot work; show the existing honest missing-data state.

### State dimensions — do not collapse into one boolean

1. Transport: `unknown | reachable | unreachable`. Browser `online` is a hint, not proof; deliberate aborts are not network failures.
2. Session: `checking | verified | offline-identity | signed-out`. Cached account metadata enables local reads only.
3. Storage: `opening | available | unavailable | blocked | quota-error`.
4. Per-group availability: `missing | ready`; refresh activity/error is separate from availability. A ready group stays ready after refresh failure.
5. Per-group freshness: `capturedAt`, `dirtySince` (nullable), `lastAttemptAt`, `lastErrorCode` (nullable). “Ready” never means “current now.”
6. Write eligibility: current verified session + reachable API + current online permission result for the target resource. A restored snapshot never grants write eligibility.

Use one shared store/provider, exposed with `useSyncExternalStore` or equivalent stable subscriptions. Existing `useOnlineStatus()` becomes a compatibility projection of that store, not a second event-listener/latch implementation.

## Tasks — execute in order

### 1. Add explicit read contracts and transactional server loaders

- Change: add `apps/api/src/trpc/outputs/offline.ts`, `groups/offline-catalog.procedure.ts`, `groups/offline-snapshot.procedure.ts`; register `groups.offlineCatalog` and `groups.offlineSnapshot`. Add a browser-safe `@spliit/api/offline-contract` package export pointing only to the schema module. Its runtime import graph may contain Zod, existing pure output schemas, and browser-safe domain helpers, never router initialization, Prisma, auth, or server environment code.
- API: use `protectedProcedure`, cookie account identity, no accountId input, no public-link/invite fields, no OpenAPI publication required. Strict input validation. These procedures are reads only.
- `offlineCatalog`: input `undefined`; response `{ schemaVersion: 1, accountId, capturedAt: Date, groups: OfflineCatalogEntry[] }`. Entry `{ overview: overviewGroupSchema with access='MEMBER', viewKey=null, lastOpenedAt=null; global: globalExpenseGroupSchema }`. All ACTIVE memberships, including archived/hidden/FRIEND. Stable group-id ordering on the wire. No saved views, bearer credentials, pending invite cards, or auth/session envelope.
- `offlineSnapshot`: input `{ groupId: nonempty string }`; response `{ schemaVersion: 1, accountId, groupId, capturedAt: Date, group: getGroupOutputSchema, overview: OfflineCatalogEntry['overview'], global: globalExpenseGroupSchema, balances: listBalancesOutputSchema, expenses: OfflineExpenseRecord[] }`.
- `OfflineExpenseRecord`: `{ list: expenseListItemResponseSchema, detail: expenseGetResponseSchema with documents replaced by OfflineDocumentMetadata[] }`. Metadata `{ id, fileName, contentType, width, height }`, same nullability as existing schema; **no URL**. List/detail duplication is intentional: use existing projections without rebuilding financial detail from list rows. IDs must match and be unique per snapshot. List documentCount must match detail metadata length.
- `group.viewer.source='MEMBER'`, `currentMember.status='ACTIVE'`, `currentInvitation=null`, `linkInviteState=null`, `hasSavedView=false`. Keep stored server permission fields as facts captured at download time; read adapters independently force effective offline actions off.
- Validate complete output, account/group identity, every expense's group relation, matching list/detail IDs, positive versions, and uniqueness before sending. `capturedAt` represents snapshot transaction start, not client write time.
- One RepeatableRead transaction for authorization + all source rows + calculations per catalog/snapshot. Refactor source loaders to accept a Prisma transaction client; default to existing Prisma where preserving existing callers. Every snapshot query must use that transaction. Set snapshot transaction timeout 30 seconds; no per-expense network calls and no N+1 previous/next lookup.
- Read expense/share/item/document/series rows in bulk. Build recurrence neighbor IDs from each series ordered by recurrenceSequence. Reuse permission mapping, display-name mapping, category mapping, recurrence conversion, and balance/subgroup logic. Preserve original endpoint behavior with regression tests.
- Missing/nonmember/inactive member group: FORBIDDEN without revealing group existence. Valid member whose group disappears: NOT_FOUND. Both evict that group's local copy after a confirmed response. UNAUTHORIZED triggers session verification; it is not a generic offline error.
- Serialize with existing SuperJSON. Send private/no-store semantics. Download via a dedicated unbatched tRPC httpLink client so a large snapshot does not block UI request batches. Client timeout 60 seconds, combined with lifecycle cancellation signal.
- No expense-count truncation or synthetic hasMore=false. Entire group response succeeds or fails. Preserve existing snapshot on timeout. Multi-page immutable server snapshots/delta sync are explicitly not part of this implementation.
- Verify: caller authorization tests; archived/hidden/FRIEND inclusion; link access rejected; output contains no token/document URL; snapshot consistency under concurrent update; empty groups; removed participants; itemized and recurring cases; list/detail/balance parity with existing endpoints.

### 2. Implement durable repository and lifecycle fencing

- Change: add `apps/web/src/lib/offline/{contract,repository,store,errors}.ts`; add `idb` runtime dependency and `fake-indexeddb` test dependency with Bun. Use IndexedDB structured cloning to preserve Date values. Parse persisted payloads with the shared runtime schemas; do not serialize auth cookies/tokens.
- Database: `spliit-offline`, IndexedDB version 1. Namespace: `JSON.stringify([normalizedApiOriginAndBasePath, accountId])`; API identity prevents mixing deployments served from one web origin.
- Object stores:
  - `control`, key namespace: `{ namespace, generation, dataRevision, enabled, revoked, leaseOwner, leaseUntil }`. generation/dataRevision are nonnegative monotonic integers, initially 0; lease fields nullable.
  - `catalog`, key namespace: `{ namespace, capturedAt, groups, schemaVersion }`.
  - `groups`, key `[namespace, groupId]`, namespace index: `{ namespace, groupId, schemaVersion, capturedAt, storedAt, commitNonce, dirtySince, payload }`. commitNonce is a fresh UUID for every replacement or deletion patch.
  - `status`, key `[namespace, groupId]`, namespace index: last attempt/result/error metadata only; never raw server error payloads or expense text.
- Default `enabled=true` for a newly verified account/device. Persist settings by namespace. Namespace isolation is a correctness boundary, not encryption: a device user can access their own browser storage.
- Repository methods: `open`, `readCatalog`, `readGroup`, `listGroupStatus`, `replaceCatalog`, `commitGroup`, `markDirty`, `evictGroup`, `setEnabled`, `clearDownloads`, `revokeNamespace`. Every mutation requires a captured generation and checks it inside its readwrite transaction.
- Group commit: validate/prepare payload outside transaction; within one transaction check current namespace/generation/dataRevision/not revoked/enabled and current lease ownership, replace one group, clear its error, and set ready metadata. Await `tx.done` before publishing readiness. Never delete old snapshot before putting the replacement.
- `markDirty` runs after successful online mutations and increments control.dataRevision in the same transaction as dirty flags/deletion patches. Every catalog/snapshot request captures dataRevision before starting; reject its commit entirely if the revision changed. Do not merely mark an old response dirty: it could resurrect a successfully deleted expense. Restart affected work. Use the counter for ordering; dirtySince is a local display timestamp only, never a cross-device/server ordering mechanism. Serialize a known mutation's local fence before accepting further snapshot commits.
- `replaceCatalog` atomically stores new catalog and removes snapshots/status for absent memberships. Never interpret an error or partial response as an empty membership list. Increment/fence generation when removing membership data so older downloads cannot resurrect it; cancel/restart the affected pass.
- Keep only one committed version per group; no durable incomplete staging. Crash before commit leaves old group untouched. A crash during transaction yields old or new complete group, never mixed records.
- IDB opening: after 3 seconds, remove blocking spinner and expose storage-unavailable retry UI while online pages remain usable. Ignore stale/late results after cancellation; safely accept eventual successful opening only through current lifecycle generation.
- `blocked`/`versionchange`: close old connections immediately on versionchange; notify other tabs to close/reload; show “Close other Spliit tabs to finish updating offline storage.” Never reload a dirty form automatically or delete the entire database as an upgrade shortcut.
- Corrupt group record: evict only that group and mark missing; redownload online. Corrupt catalog: keep validated group snapshots as explicitly incomplete inventory, disable account-wide totals, request catalog refresh. Newer unsupported schema: do not interpret or overwrite; request app update. For future migrations, use explicit versioned migration code; app build SHA is not a data cache buster.
- Quota failure: transaction abort preserves old data; stop new background writes for that pass; show storage error and “Retry”/“Clear downloads.” Do not auto-evict arbitrary groups or claim complete coverage. `navigator.storage.estimate()` is informational, not a capacity guarantee.
- Retention: no maxAge, no LRU expiry, no foreground-time expiry. Requested clear/revocation and confirmed membership loss are explicit deletion events.
- Verify with fake-indexeddb: Date roundtrip; commit rollback; old generation rejection; clear-vs-late-response; quota/corruption; namespace isolation; schema mismatch; versionchange closure. Also verify browser IndexedDB separately; mocks do not prove Safari behavior.

### 3. Centralize account ownership, cross-tab events, and connectivity

- Change: add `offline/provider.tsx`, `offline/lifecycle.ts`, `offline/connectivity.ts`; mount one provider inside TRPCProvider before account preference sync, saved-view merging, and route content. Keep public/auth pages usable when storage is unavailable.
- Move last-account write/clear side effects to the single lifecycle owner. Keep `useCurrentAccount` consumer API stable where possible. An offline-identity may be restored only from matching last-account metadata plus a nonrevoked namespace. Never scan other account namespaces to choose an identity.
- On cold start, start local restore and session verification concurrently. Cached identity may display matching local reads immediately; no server mutation until verification. A network timeout/5xx preserves the read identity. A successful get-session null response revokes it. Skip hanging session waits when browser explicitly reports offline.
- Session verification: credentialed `getSession({ query: { disableCookieCache: true } })`, with 8-second bound. Use the same bounded request machinery for session bootstrap; no unbounded loading branch in RequireAuth. HTTP 401/tRPC UNAUTHORIZED initiates this check. A group FORBIDDEN alone does not sign the user out.
- Account switch A -> B: synchronously stop rendering A, abort A requests, clear account-sensitive QueryClient entries and worker memory, increment/revoke A generation, clear A persisted data, then mount B's read context. Do not reuse singleton query results during the switch. Failure to physically delete must still fence A from reads/writes and show a cleanup failure.
- Successful sign-out: perform local revocation even if cleanup fails; remove last-account snapshot; clear queries and worker memory; navigate out. An old tab cannot repopulate last-account from stale Better Auth hook data; require a fresh successful session response after cross-tab invalidation.
- A later successful uncached server session verification may reactivate a previously revoked namespace for that same account: finish deletion of old revoked payloads, increment generation, reset dataRevision/lease for the new empty lifecycle, and only then clear its revocation marker. Preserve the device's enabled/disabled preference. Never reactivate from cached hook data or a health probe.
- Offline sign-out is not introduced: retain existing server-confirmed sign-out behavior with “Connect to sign out.” Clearing downloads is available offline and does not revoke the server session. Do not claim server logout succeeded without contacting it.
- Cross-tab channel `spliit-offline-v1`: events `{ type, namespace, generation, groupId? }`, types `committed`, `catalog-changed`, `dirty`, `cleared`, `revoked`, `storage-close`. No payloads, account profile data, or tokens in messages. Use BroadcastChannel with storage-event fallback carrying an event nonce. On focus, recheck control record even if messages were missed.
- Data deletion/fencing must work without BroadcastChannel. Marker key `spliit:offline:revoked:${encodeURIComponent(namespace)}`, value a unique event UUID: write synchronously before asynchronous revocation/deletion; check before restore/commit. Lifecycle callbacks capture marker value and reject if it changes. Fallback notification key `spliit:offline:event` contains the channel event plus unique nonce. If localStorage is unavailable, rely on IDB generation checks and live control validation. Never treat failed storage access as successful clearance.
- Transport `unreachable`: navigator false, genuine network failure, or bounded request timeout. HTTP 4xx/5xx is a server response, not proof of a working session; show distinct server failure copy and retain snapshots. User cancellation/account-switch abort does not set offline status.
- Recovery probes bypass the offline guard: call existing `/health/liveness` with `cache:'no-store'`, 5-second timeout; validate successful JSON health shape to reject captive portal HTML. Probe on online event, visible foreground, explicit Retry, and 5/15/30/60-second backoff while visible and navigator says online. Stop periodic probes when hidden or navigator says offline. Only one probe at a time.
- A successful probe enables session verification, not writes. After session verifies, refetch group/expense permissions used by the visible screen before enabling their actions. Unrelated groups downloading must not block an already revalidated visible screen.
- Keep TanStack's query online state in agreement with transport; local IndexedDB queries use `networkMode:'always'`. Probe/auth checks must not be disabled by the same offline state they are supposed to repair.
- Verify with fake clocks/events: false-positive navigator.online; recovery without online event; 503 versus network error; null session versus failed session; different-account response; stale-tab reactivation; foreground after missed revoke; StrictMode mount/unmount; no repeated global listener registration.

### 4. Download complete groups predictably

- Change: add `offline/sync.ts`. No service-worker sync queue; downloads run only in an open visible document. Let an in-flight request finish when hidden, but do not start the next group until visible. A closed/suspended app makes no refresh guarantee.
- Acquire an IDB-backed per-namespace lease: random tab owner, 30-second expiry, renew every 10 seconds during work; compare owner/generation inside the same control transaction. Loser tabs read committed results. A crashed owner becomes replaceable after expiry. Generation fencing remains necessary even with a lease.
- Pass order: verify session -> fetch catalog -> commit/reconcile catalog -> current group first -> missing groups -> dirty groups -> remaining groups by overview recency, groupId as deterministic tie-breaker.
- Triggers: each authenticated launch; successful reconnect; explicit Retry/Refresh now; foreground return if last completed full pass older than five minutes; successful relevant mutation. Coalesce triggers into one pass and one pending rerun, never overlapping account passes.
- Launch/reconnect/refresh passes download all catalog groups once. Mutation-triggered passes refresh catalog plus affected groups; mutations without a resolvable groupId request a full pass. Do not poll/download the entire account every five minutes while continuously active; the five-minute rule applies to foreground return.
- Retries: one automatic retry after 5 seconds per transient group error in a pass, then continue to other groups. For 429, parse Retry-After seconds/date; never retry before it. If the delay exceeds 60 seconds, end automatic work for that pass, retain error/readiness, and store earliestRetryAt; a later trigger retries only after that deadline. Missing/invalid Retry-After uses 60 seconds. No retry for schema/auth/access errors. Global connectivity failure pauses pass and hands control to recovery probes. Explicit Retry bypasses transient-error backoff once, but never the server's Retry-After deadline.
- Snapshot request timeout 60 seconds. A failed large group does not prevent other groups downloading. Show counts of complete groups, not fabricated byte progress. While downloading group N, show its name and indeterminate activity.
- Disabling automatic downloads cancels the pass, increments generation, retains completed snapshots, and prevents new commits. Re-enabling starts a fresh pass. “Refresh now” is available only when enabled; Retry for an enabled failed pass restarts missing/failed work.
- “Clear downloads” confirms destructive local removal, increments generation, sets enabled=false, deletes catalog/group/status records, and broadcasts clearance. Do not clear SW caches, appearance settings, or server data. Never immediately repopulate cleared data through query callbacks.
- Online mutations: existing success behavior stays immediate; schedule offline refresh asynchronously without delaying mutation success. Successful expense delete additionally removes that expense from local list/detail in an atomic transaction and marks balances/overview stale. Group delete/leave immediately evicts group and catalog entry. Other writes retain old complete snapshot with dirty/freshness indicator until refreshed; do not hand-recalculate financial totals from optimistic data.
- A write with unknown outcome (response lost) does not trigger automatic replay. Retain existing idempotency flow; show existing failure/unknown-result feedback and refresh reads when possible.
- Verify: one download owner across tabs; current group priority; restart after crash; failed group does not starve others; disable/clear in flight; mutation during snapshot capture; deleted expense cannot reappear from an older response; renewal loss cancels/fences commits.

### 5. Build read adapters and basic local query engine

- Change: add `offline/read-model.ts`, `offline/read-hooks.ts`, `offline/query-worker.ts`; migrate the core consumers listed above. Export hooks `useOfflineOverview`, `useOfflineGroup`, `useOfflineExpenses`, `useOfflineExpense`, `useOfflineBalances`, `useOfflineGlobalExpenses`, `useOfflineFilterOptions` (names describe adapters, including online behavior).
- Common result metadata: `{ source:'network'|'download', capturedAt:Date|null, availability:'loading'|'ready'|'missing'|'error', refreshing:boolean, incompleteGroupCount:number }`; data uses existing view DTO shape or an explicitly typed attachment-metadata variant. Errors/absence are not empty arrays.
- Keep network and local query keys disjoint. Local key prefix `['offline', namespace, generation, groupSnapshotVersion, ...]`; use storedAt plus a commit nonce as version, not server timestamp alone. Never insert a whole downloaded history into a live tRPC infinite-query page.
- Selection: matching complete live network result wins; otherwise use complete local snapshot immediately. Failed revalidation retains readable data with stale/download indicator. Local source remains active for the current list until the corresponding first network page succeeds, then atomically reset that list's source/pages. Cancel obsolete loads on account/source/filter changes. Never append server pages onto local pages.
- During an online refresh, existing in-memory live data may remain visible. After restart, only committed snapshots survive. Do not persist successful arbitrary query responses into the snapshot store.
- Expense missing from complete group snapshot: “This expense isn't in this device's download. Reconnect to check for newer expenses.” It is not proof of server deletion. Group with no snapshot: “This group hasn't finished downloading.” Empty complete group: normal empty state.
- Group balances render stored server response. Do not infer totals from filtered/list pages. If dirtySince is set, label “Balances may be out of date.” After applying a successful online deletion to the offline store, this warning is mandatory until a coherent refresh commits.
- Offline overview uses catalog cards plus each ready group's stored overview entry. Undownloaded groups retain names/metadata but financialSummary is UNAVAILABLE. Derive account aggregates/people balances from ready group snapshots using extracted pure existing overview helpers and participant account identities. Show account-wide totals only when every catalog group is ready and none is dirty; otherwise show “Reconnect to update totals.” Always expose oldest contributing capturedAt for complete aggregates.
- Offline catalog/preferences: keep hidden/starred/archive state from most recently committed catalog; group financial summaries/balances come from group snapshots. This is explicitly last-known state, not a single account-wide transaction.
- Global list: union all ready snapshots, join stored global group metadata; default exclude hidden and archived groups exactly like current server. Explicit groupIds takes precedence as current API does; includeArchived defaults false. Include missing/dirty group count above results; never turn partial aggregate totals into authoritative totals.
- Local query engine runs in a dedicated Web Worker to avoid blocking scrolling/search on large accounts. Worker reads validated snapshots via read-only IDB, caches only current query working set, and drops account data on generation events. Reply with requestId/generation and discard obsolete responses. CSP/Worker failure falls back to the same pure functions in chunked main-thread tasks, yielding every 500 rows; core reads still work.
- Local page size 20. For plain lists use local offsets with source-version key. For collapsed involvement mode consume until 20 involving rows plus intervening hidden rows, capped at 100 hidden rows per delivery; preserve hidden runs and continue without omissions/duplicates. No server cursor encoding is reused locally. Reset pagination when query/filter/sort/source version changes.
- Preserve existing URL filter state, debounce, and timeline rendering helpers. Local page additions preserve scroll. Reconnect may change results, but preserve top visible expense anchor when it survives; otherwise return list to top without repeated jump loops.
- Basic search: trimmed, case-insensitive substring; group list searches title + localized category expansion; global list additionally searches notes/item titles, matching current non-fuzzy scopes. No accent stripping, stemming, typo correction, relevance ranking, or network request. Display one subdued helper while search is nonempty offline: “Offline search uses exact text; typo matching needs a connection.”
- Filters: reuse parsed input values from existing UI; inclusive date/amount bounds; category expansion via existing domain function; explicit categories override hideSettlements as server does. any/all/exact payer/beneficiary sets preserve current semantics. Group originalCurrency filter and global base-currency key filter stay distinct. Global amount filters/sort require exactly one base currency, with the existing validation state.
- Sort group lists: expenseDate primary selected direction, then createdAt descending, id descending; createdAt/amount primary selected direction then id descending. Global: selected primary and all tie-breakers follow selected direction; expenseDate has createdAt then id. Test equal timestamps/amounts explicitly.
- Filter options derive from complete downloaded records/group context; no remote prerequisite before offline list rendering. Expose unavailable groups as not downloaded rather than selectable as empty. Preserve removed/unlinked participant identity in historical expense rendering.
- Verify: cold direct routes; all expenses including never-opened details; local/network source change; 20+ pages; involvement hidden gaps; stale replies; group/global currency differences; any/all/exact; category overrides; date bounds and DST fixtures; recurrence neighbor navigation; basic text search; invalid/unknown URL filters retain existing UI normalization.

### 6. Enforce read-only behavior before side effects

- Change: add `offline/write-guard.ts`; wire QueryClient MutationCache and a tRPC guard link before terminating links. Audit all `.useMutation`, imperative `.mutate`, auth calls, upload fetches, and automatic write effects, including saved-view touch/merge and account preference sync.
- Mutation defaults `networkMode:'always'`, `retry:0`: known-offline actions must reject immediately, not enter TanStack's paused mutation queue. No `resumePausedMutations`, persister, or mutation restoration.
- Global MutationCache.onMutate asserts eligibility **before per-mutation optimistic onMutate**. Transport guard rechecks immediately before any imperative tRPC mutation. Both throw typed client `OfflineWriteError` without sending a request. Confirm ordering against installed TanStack version with an actual QueryClient regression test.
- UI entry checks happen before analytics that claim success, route transitions, optimism outside onMutate, form reset, and local dirty-state clearing. One accessible “Reconnect to make changes” explanation; suppress duplicate generic error toasts for OfflineWriteError. Rollback callbacks tolerate missing optimistic context.
- Group context adds independent `connectionReadOnly`/write eligibility, not fabricated `PENDING_INVITATION` access. Keep server authorization unchanged; effective actions are intersection of server permission and connectivity/session state.
- Disable create/edit/delete/archive/settle/invite/comment/import/AI/export/manage actions in menus, keyboard shortcuts, mascot, dialogs, and deep links. Browse/filter/expand/close/back/copy already-present plain text remain usable. Sharing/generating authenticated links requires connection.
- If a form was already dirty when connectivity failed, preserve its in-memory values and existing navigation/PWA-update blocker; disable submission and show that it is not saved. Do not introduce durable draft storage. Reconnect refetches permission/version without replacing dirty form inputs; existing version-conflict handling remains authoritative.
- Local theme/locale/download settings may change offline. Do not queue remote preference writes; background account preference sync must neither push offline nor overwrite the local choice while disconnected. On reconnect use existing preference precedence, without pretending a remote save happened offline.
- Auth sign-in/recovery/social redirect and remote account changes are connection-required. Explicit recovery probes/session verification bypass write guard. Read-only procedures encoded as tRPC mutations are also blocked offline; no background transport calls merely because they are semantically reads.
- Verify: test real QueryClient ordering; blocked mutation has no optimism, fetch, paused entry, retry, or reconnect replay; invoke direct client mutation; automatic effects; repeated clicks; dirty form survives disconnection; authenticated permissions required before re-enable.

### 7. Deliver honest, unobtrusive status and device controls

- Change: reuse OfflineBanner/OfflineEmptyState; add `components/offline-download-status.tsx` and `app/account/offline-download-settings.tsx`, using existing SettingsSection primitives. Show device controls for anonymous accounts too.
- Persistent banner only when disconnected/recovering or server unavailable. Offline text: “You're offline. Downloaded data is read-only.” Server outage text: “Can't reach Spliit right now. Showing downloaded data.” Recovering text: “Reconnecting… You can keep reading downloaded data.” Never say changes will sync later.
- Home/settings compact status: “Downloading groups ({ready}/{total})”, “Available offline”, “Some groups aren't downloaded”, “Downloads paused”, or “Offline storage unavailable”. Success requires all eligible groups ready and no active failure; if dirty groups remain, use “Downloads need updating”. Zero-member account uses “No groups to download.”
- Per-group status/details: ready/missing, capturedAt, refreshing/error, Retry. Dates use active locale; short relative text with exact localized date/time accessible in details. No toast per group and no repeating announcements on every row/page.
- Settings: automatic-download switch (default on); ready/total count; last completed full pass; approximate storage if available; Refresh now; Clear downloads. Clear confirmation: “Remove downloaded groups and expenses from this device? Your server data stays safe. Automatic downloads will be turned off.”
- Storage persistence: no automatic permission prompt. Optional settings action “Keep downloads on this device” invokes `navigator.storage.persist()` only on click. Denied/unsupported result does not block downloads; explain browser-managed storage. Do not claim persistence eliminates user clearing or device loss.
- Missing data: explain what is absent and show Retry when network recovery is possible, plus link back to groups. Unsupported offline screen: “This feature needs a connection” with back navigation. Do not route all offline pages to one generic error screen.
- Attachment rows: show filename/type/count and “Connect to view attachments”; no empty src requests, expiring URLs, broken-image icons, or links that fail silently. Avatar fallback must preserve layout dimensions.
- No full-screen synchronization overlay; no layout shift over content; status has `role=status`/polite announcements. Errors requiring intervention remain visible until resolved/dismissed, not only transient toasts. Respect reduced motion.
- Add English keys and translations using `bun i18n` only. Follow `.agents/skills/translate-strings/SKILL.md`, CLI guides, and single-brace interpolation. Never hand-edit messages. Use keys under `OfflineDownloads`, `OfflineReadOnly`, and existing banner/empty-state namespaces.
- Verify accessibility, narrow mobile layout, long translations, dark mode, and offline account-settings navigation. Error must be recoverable using visible controls without DevTools.

### 8. Validate production behavior and document release

- Add focused unit/component tests alongside new modules; use existing Vitest conventions. Add DB-backed createCaller tests for snapshot integrity and authorization. Integration must not start the API.
- Add deterministic fixtures: empty group; ordinary group; archived and hidden group; FRIEND group; itemized splits; multiple currencies; removed participants; recurrence; 45 expenses with tied dates/amounts; 250 consecutive non-involving expenses; account switch; revoked membership.
- Large-data acceptance fixture: 20 groups, 10,000 total expenses, including one group with 8,000 expenses, itemized rows and attachment metadata. These are acceptance targets, not measured production sizes. No N+1 detail calls; one network snapshot request per group; no silent caps.
- Performance target on documented test hardware: local first-page render within 1 second after IDB becomes available; query/filter worker results within 500 ms for the large fixture; no continuous main-thread task above 100 ms caused by filtering. Snapshot transfer completes within the selected 60-second client timeout on local integration infrastructure. Record actual measurements and device; do not call these targets met from unit mocks.
- Production PWA manual matrix: installed iOS Safari, Android Chrome if available, desktop Chromium, normal browser; app killed then airplane-mode launch; direct deep link; reload; navigator.online true with API blocked; foreground reconnect; two tabs; service-worker update before/after offline launch; old tab blocks IDB upgrade; storage cleared/quota failure/private storage restriction.
- Do not claim browser/device coverage that was not executed. If no authorized production preview or physical device is available, report that exact validation gap; do not start a service or fabricate results.
- Required commands from repo root after implementation: `bun --filter @spliit/web test`, `bun --filter @spliit/api test`, `bun --filter @spliit/domain test`, `bun --filter @spliit/web check-types`, `bun --filter @spliit/api check-types`, `bun --filter @spliit/domain check-types`, corresponding package `lint` and `check-formatting`, `bun --filter @spliit/web build`, `bun i18n check --changes-only`. Run relevant integration configuration only with its required existing infrastructure. Read/apply the react-doctor skill when finishing React implementation.
- Inspect emitted SW manifest: all core routes, offline worker chunk, locale/category assets, and offline read modules included. API/auth/document responses must not appear in runtime/precache data caches. Preserve coordinated-update tests.
- Add `releases/next.md` feature entry: all member groups/expenses/balances downloadable for read-only offline use; files and edits still require connection. Use literal attribution ``(`TBD` by @TBD)`` if contributor unknown, per releases/README.md. Do not create release notes during this handoff-only task.
- Diagnostics: existing logging style; codes, duration, group counts, serialized sizes if measured; no expense titles, notes, names, tokens, or raw snapshots. Separate network, server, authorization, schema, quota, blocked-storage, and cancellation outcomes. UI status must be driven by actual commits.

## Failure decisions — implementation must match

| Event | Required result |
| --- | --- |
| First-ever offline visit | Shell if installed/cached; explain no downloaded data; no sign-in loop or indefinite spinner. |
| Refresh fails with existing snapshot | Continue reading old snapshot with timestamp/error; never replace it with empty results. |
| Initial group download interrupted | Group remains missing; other ready groups usable; retry restarts whole group. |
| Full catalog returns zero groups | Reconcile to zero and evict old memberships; valid empty state. |
| Catalog request fails | Retain prior catalog/snapshots; do not evict membership data. |
| Explicit snapshot FORBIDDEN/NOT_FOUND | Evict that group and invalidate aggregate views immediately. |
| Remote deletion while device offline | Last-known copy can remain until contact; no promise of instantaneous remote erasure. |
| Successful expense deletion, snapshot refresh fails | Deleted detail/list row absent; totals visibly stale; no ghost from late refresh. |
| Successful sign-out, IDB deletion fails | Local identity blocked/revoked and memory cleared; show cleanup failure, retry deletion; no silent success claim for disk cleanup. |
| Storage evicted | Detect absent records; mark missing; redownload online. Never restore “ready” from stale status metadata alone. |
| App changes schema | Compatible migration or explicit update/redownload state; no blanket cache wipe keyed by build SHA. |
| API returns 500 or captive-portal HTML | Retain read data; no verified session or writes inferred from a resolved fetch. |
| Network returns during local search | Keep usable results until fresh network source is ready; no mixed cursors or duplicate rows. |
| Known offline mutation requested | Immediate typed error before optimism/network; never saved, queued, retried, or replayed. |
| Network dies after mutation sent | Existing failure/idempotency behavior; unknown outcome acknowledged, reads refreshed later; no automatic resubmission. |

## Acceptance

- With all groups marked ready, force-close app, disable network, reopen at home and at an expense never previously opened: correct account, full content, no network prerequisite.
- Browse every downloaded expense page, view itemized details and balances, switch groups, filter/sort/basic-search, and return from expense preview entirely offline.
- No false zero balance, false empty history, downloaded-file promise, silently truncated history, or permanently spinning core view.
- Download failure cannot destroy a usable snapshot. Data returned after clear/sign-out/access loss cannot resurrect revoked content.
- Account A data never renders under B; cross-tab sign-out/account switching invalidates both durable ownership and live query memory.
- No offline mutation side effects or automatic replay. Reconnect enables edits only after session and relevant permissions are revalidated.
- Offline-ready indicator corresponds to committed, valid data; partial readiness and freshness are separately visible.
- Large fixture meets measured targets; unit/component/API checks pass; executed production-browser coverage and any unavailable device checks are reported precisely.
- Feature code, translations, release draft, and tests are complete; no background services started without permission; no undocumented schema/API changes.

## Remaining risks / external validation

- Browser-managed storage can be evicted or cleared. Persistence requests reduce some eviction risk but cannot guarantee retention; the UI contract explicitly handles missing downloads. Reference: [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- Full snapshots trade simple atomic correctness for transfer size. Large-data validation is a release gate. If measured supported workload exceeds limits, report the measured blocker before replacing this architecture with a staged immutable transfer protocol; do not silently cap records or ship partial data as complete.
- Device-only offline data is not remotely revocable while disconnected. Server-confirmed revocation purges it on reconnect. This is inherent in the selected retention requirement.
- TanStack mutation-hook ordering was checked against current upstream source, not installed runtime; lock it down in a repository regression test. Reference: [TanStack mutation execution](https://github.com/TanStack/query/blob/main/packages/query-core/src/mutation.ts). IDB transaction/upgrade implementation reference: [idb](https://github.com/jakearchibald/idb).
- Production service-worker/device tests require existing or explicitly authorized infrastructure. No implementation or validation success is implied by this handoff.

Next: implement Task 1's browser-safe contracts and transaction-injected bulk snapshot loaders, with authorization/coherence tests, before wiring persistence or UI.
