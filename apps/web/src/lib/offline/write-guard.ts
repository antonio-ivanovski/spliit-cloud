import { MutationCache } from '@tanstack/react-query'
import type { TRPCLink } from '@trpc/client'

import { getDefaultConnectivityStore } from './connectivity'
import type { SessionState } from './lifecycle'

/**
 * Offline write guard.
 *
 * Transport guard (this module) blocks known-offline writes before any optimism
 * or network request. UI eligibility (verified session + reachable transport +
 * refetched server permission) disables affordances; the guard is the last line
 * of defence and covers every TanStack/tRPC mutation, including imperative
 * `client.mutate`, repeated clicks, and automatic effects.
 *
 * Ordering (verified against installed `@tanstack/react-query@5.103.1`,
 * `query-core/build/modern/mutation.js` `Mutation.execute`): the
 * `MutationCache.config.onMutate` callback is awaited BEFORE the per-mutation
 * `options.onMutate`. Throwing `OfflineWriteError` there skips per-mutation
 * optimism, skips the mutationFn (no fetch), and routes to `onError`/`error`
 * state with the original error re-thrown. With `networkMode:'always'` +
 * `retry:0` the rejection is immediate: the mutation never enters TanStack's
 * paused queue, never retries, and never replays on reconnect. No
 * `resumePausedMutations`, persister, or mutation restoration is used.
 *
 * The tRPC guard link rechecks immediately before any imperative tRPC mutation
 * and throws the same typed error without sending a request. Probes (`GET
 * /health/liveness` plain fetch) and session verification
 * (`authClient.getSession`) bypass this guard by construction: they never go
 * through `MutationCache` or the tRPC mutation link.
 *
 * Allow / block table (client):
 *
 * | Action                                                                                                                                                                                       | Path                                                                                                                    | Offline                                                                                                                                                                              |
 * | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
 * | expenses create/update/delete/stopRecurrence/bulkUpdateCategories                                                                                                                            | `trpc.groups.expenses.*.useMutation`                                                                                    | BLOCK (guard + disabled UI)                                                                                                                                                          |
 * | balances settle (expense create w/ settlement category)                                                                                                                                      | `useCreateExpenseMutation` via `CreateSettlementModal`                                                                  | BLOCK                                                                                                                                                                                |
 * | groups create/update/archive/delete/leave                                                                                                                                                    | `trpc.groups.*.useMutation`                                                                                             | BLOCK                                                                                                                                                                                |
 * | comments create/delete                                                                                                                                                                       | `trpc.groups.expenses.comments.*.useMutation`                                                                           | BLOCK                                                                                                                                                                                |
 * | members/invites/participants/roles/links (create/update/remove/leave/revoke/regenerate/accept/decline/acceptLink)                                                                            | `trpc.invitations.*`, `trpc.groups.members.*`, `trpc.groups.participants.*`                                             | BLOCK                                                                                                                                                                                |
 * | subgroups/split-presets create/update/delete/setEnabled/setDefault                                                                                                                           | `trpc.groups.subgroups.*`, `trpc.groups.splitPresets.*`                                                                 | BLOCK                                                                                                                                                                                |
 * | budgets create/update/archive/delete                                                                                                                                                         | `trpc.groups.budgets.*`                                                                                                 | BLOCK                                                                                                                                                                                |
 * | imports (group import, cloud bundle, CSV import, duplicate preview, document discovery)                                                                                                      | `trpc.groups.import*`, `trpc.groups.expenses.importFile/previewImportDuplicates`, `trpc.groups.discoverImportDocuments` | BLOCK                                                                                                                                                                                |
 * | AI (receipt image/audio extract, suggestCategory, bulk calibrate/preview)                                                                                                                    | `trpc.ai.*`, `trpc.groups.expenses.suggestCategory`                                                                     | BLOCK (read-semantic mutations also blocked: no background transport merely because semantically reads)                                                                              |
 * | exports (PDF/CSV/bundle hrefs, report dialog)                                                                                                                                                | REST hrefs + `report-print` queries                                                                                     | BLOCK (disabled UI; no fetch)                                                                                                                                                        |
 * | uploads presign (expense/profile/import/cloud) + S3 PUT                                                                                                                                      | `trpc.uploads.*.useMutation` + `uploadToPresignedUrl` fetch                                                             | BLOCK (presign via guard; PUT via UI entry check, never auto-retried)                                                                                                                |
 * | saved-view touch/save/remove/merge                                                                                                                                                           | `trpc.groups.savedViews.*.useMutation` + `MergeDeviceSavedViews` effect                                                 | BLOCK (automatic touch/merge effects skip while offline; device views stay local)                                                                                                    |
 * | account remote writes (updateProfile, setProfileImage, preferences init/update/setPreference, notification save, push register/remove, authorized-client revoke, password set/change/remove) | `trpc.account.*`, `trpc.notifications.*`, `trpc.uploads.profileImagePresign`, better-auth password APIs                 | BLOCK remote push offline; local theme/locale/download settings remain usable (see below)                                                                                            |
 * | currency rates (read-semantic mutation)                                                                                                                                                      | `utils.client.currency.rates.mutate`                                                                                    | BLOCK (encoded as mutation, so guard applies)                                                                                                                                        |
 * | auth sign-in/sign-up/magic-link/social/anonymous + recovery + remote account changes                                                                                                         | `authClient.*` via `useAuthPanel`, dialogs, `account-menu` sign-out                                                     | CONNECTION-REQUIRED (UI entry check on transport; transport guard rejects TanStack-wrapped auth mutations offline; social redirects gated before navigation)                         |
 * | recovery probes + session verification                                                                                                                                                       | plain `fetch(/health/liveness)` + `authClient.getSession(disableCookieCache)`                                           | BYPASS guard (they repair connectivity/session and must never be disabled by it)                                                                                                     |
 * | local theme/locale/download toggles, browse/filter/expand/close/back, copy plain text                                                                                                        | ThemeProvider, LocaleSwitcher, offline settings, list UI                                                                | ALLOWED offline (no remote push; preference sync neither pushes nor overwrites local choice while disconnected)                                                                      |
 * | read queries (group/expense/balances/overview/global, comments list display, filter options)                                                                                                 | tRPC queries + offline adapters (`networkMode:'always'`, disjoint keys)                                                 | ALLOWED (offline adapters serve downloads; comment/activity/stats/budget/member-admin/report/export/AI/import screens show connection-required instead of launching network queries) |
 *
 * UI rules: entry checks run BEFORE analytics claiming success, route
 * transitions, optimism outside `onMutate`, form reset, and local dirty
 * clearing. Blocked mutations surface ONE accessible "Reconnect to make
 * changes" explanation; per-mutation generic error toasts are suppressed for
 * `OfflineWriteError` (see `isOfflineWriteError` +
 * `notifyOfflineWriteBlocked`). Rollback handlers tolerate a missing optimistic
 * context (guard throws before any context exists).
 */

export const OFFLINE_WRITE_BLOCKED_MESSAGE = 'Reconnect to make changes'
export const OFFLINE_WRITE_ERROR_NAME = 'OfflineWriteError'

export class OfflineWriteError extends Error {
  readonly code = 'offline-write-blocked' as const

  constructor(message: string = OFFLINE_WRITE_BLOCKED_MESSAGE) {
    super(message)
    this.name = OFFLINE_WRITE_ERROR_NAME
  }
}

export function isOfflineWriteError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  if (error instanceof OfflineWriteError) return true
  const record = error as Record<string, unknown>
  if (record.name === OFFLINE_WRITE_ERROR_NAME) return true
  // tRPC/react-query may wrap the original in `cause`/`data.cause`.
  const cause = (record.cause ?? record.data) as unknown
  if (cause && typeof cause === 'object') {
    const nested = cause as Record<string, unknown>
    if (nested.name === OFFLINE_WRITE_ERROR_NAME) return true
    if (nested.cause instanceof OfflineWriteError) return true
  }
  return false
}

/** Suppress the generic per-mutation error toast for guard rejections. */
export function shouldSuppressGenericToast(error: unknown): boolean {
  return isOfflineWriteError(error)
}

export type WriteGuardTransport = 'unknown' | 'reachable' | 'unreachable'

export type WriteGuardDeps = {
  getTransport?: () => WriteGuardTransport
  isNavigatorOnline?: () => boolean
}

let testDeps: WriteGuardDeps | null = null

/** Test-only injection for the transport snapshot. */
export function configureWriteGuardForTests(deps: WriteGuardDeps | null): void {
  testDeps = deps
}

/** Test-only: drop injected deps. */
export function resetWriteGuardForTests(): void {
  testDeps = null
}

function readTransport(): WriteGuardTransport {
  const injected = testDeps?.getTransport
  if (injected) {
    try {
      return injected()
    } catch {
      return 'unknown'
    }
  }
  try {
    return getDefaultConnectivityStore().getSnapshot()
      .transport as WriteGuardTransport
  } catch {
    return 'unknown'
  }
}

function readNavigatorOnline(): boolean {
  const injected = testDeps?.isNavigatorOnline
  if (injected) {
    try {
      return injected()
    } catch {
      return true
    }
  }
  try {
    if (typeof navigator === 'undefined') return true
    return navigator.onLine !== false
  } catch {
    return true
  }
}

/**
 * Known-offline transport: explicit `unreachable` OR the browser reporting
 * `navigator.onLine === false`. `unknown` fails open (not proven offline) so
 * normal online startup mutations are never blocked before the first probe.
 */
export function isKnownOfflineTransport(deps?: WriteGuardDeps): boolean {
  const transport = deps?.getTransport
    ? safeGetTransport(deps.getTransport)
    : readTransport()
  if (transport === 'unreachable') return true
  const online = deps?.isNavigatorOnline
    ? safeGetNavigatorOnline(deps.isNavigatorOnline)
    : readNavigatorOnline()
  return online === false
}

function safeGetTransport(fn: () => WriteGuardTransport): WriteGuardTransport {
  try {
    return fn()
  } catch {
    return 'unknown'
  }
}

function safeGetNavigatorOnline(fn: () => boolean): boolean {
  try {
    return fn()
  } catch {
    return true
  }
}

/** Throw `OfflineWriteError` without sending a request when offline. */
export function assertTransportOnline(deps?: WriteGuardDeps): void {
  if (isKnownOfflineTransport(deps)) {
    throw new OfflineWriteError()
  }
}

/**
 * UI write eligibility: verified session + reachable transport. Server
 * permission for the visible resource is refetched after verification and
 * intersected at the call site (`useGroupWriteEligibility`); unrelated
 * downloads never block the revalidated screen.
 */
export function isWriteEligible(input: {
  session: SessionState
  transport: WriteGuardTransport
}): boolean {
  return input.session === 'verified' && input.transport === 'reachable'
}

export const WRITE_GUARD_MUTATION_DEFAULTS = {
  networkMode: 'always',
  retry: 0,
} as const

/**
 * Global `MutationCache` config. `onMutate` runs BEFORE per-mutation `onMutate`
 * (installed query-core ordering, see module doc), so throwing here prevents
 * optimism, fetch, paused entries, retries, and replay.
 */
export function createWriteGuardMutationCache(): MutationCache {
  return new MutationCache({
    onMutate: () => {
      assertTransportOnline()
    },
  })
}

let lastBlockedToastAt = Number.NEGATIVE_INFINITY
const BLOCKED_TOAST_DEDUPE_MS = 3000

/**
 * Single accessible "Reconnect to make changes" explanation with dedupe so
 * repeated clicks do not spam generic error toasts. Call from mutation
 * `onError` when `isOfflineWriteError(error)` is true and return early.
 */
export function notifyOfflineWriteBlocked(
  notify: (message: string) => void,
  now: () => number = Date.now,
): boolean {
  const at = safeNow(now)
  if (at - lastBlockedToastAt < BLOCKED_TOAST_DEDUPE_MS) return false
  lastBlockedToastAt = at
  try {
    notify(OFFLINE_WRITE_BLOCKED_MESSAGE)
  } catch {
    // Notification failures must never break mutation handling.
  }
  return true
}

function safeNow(now: () => number): number {
  try {
    return now()
  } catch {
    return 0
  }
}

/** Test-only: reset the blocked-toast dedupe window. */
export function resetOfflineWriteBlockedToastForTests(): void {
  lastBlockedToastAt = Number.NEGATIVE_INFINITY
}

/**
 * TRPC guard link. Mount BEFORE terminating links so blocked mutations never
 * reach `fetch`. Only `mutation` operations are checked; queries/subscriptions
 * (including offline adapters with `networkMode:'always'`) pass through.
 */
// oxlint-disable-next-line no-explicit-any -- tRPC router generic is supplied by the caller (AppRouter) at mount time.
export function createOfflineWriteGuardLink(): TRPCLink<any> {
  return () => {
    return ({ op, next }) => {
      if (op.type === 'mutation') {
        assertTransportOnline()
      }
      return next(op)
    }
  }
}
