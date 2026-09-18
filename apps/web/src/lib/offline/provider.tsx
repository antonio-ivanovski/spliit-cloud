import { onlineManager, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { getApiBaseUrl } from '@/lib/api-url'
import { authClient, type AuthAccount } from '@/lib/auth'
import {
  clearLastAccount,
  readLastAccount,
  writeLastAccount,
} from '@/lib/last-account'
import { isNetworkError } from '@/lib/network-error'

import {
  getDefaultConnectivityStore,
  isTransportFailure,
  type ConnectivityStore,
} from './connectivity'
import { buildNamespace } from './contract'
import {
  createOfflineChannel,
  createOfflineLifecycle,
  SESSION_VERIFY_TIMEOUT_MS,
  type OfflineChannelEvent,
  type OfflineLifecycle,
  type SessionFetchResult,
} from './lifecycle'
import { createOfflineStore, type OfflineStore } from './store'
import {
  createOfflineDownloadFetchers,
  createOfflineSync,
  type OfflineSync,
  type SyncStatusSnapshot,
  type SyncVerifyFn,
} from './sync'

/**
 * Central offline provider.
 *
 * Mount one instance inside `TRPCProvider`, before account preference sync,
 * saved-view merging, and route content. Renders children immediately so
 * public/auth pages stay usable while IndexedDB opens in the background.
 * StrictMode-safe: store creation is memoized per mount, global listeners are
 * idempotent (`connectivity.start()` guards duplicates), and every effect
 * cleans up its own listeners/timers.
 */

const OfflineLifecycleContext = createContext<OfflineLifecycle | null>(null)
const OfflineConnectivityContext = createContext<ConnectivityStore | null>(null)
const OfflineStorageContext = createContext<OfflineStore | null>(null)
const OfflineSyncContext = createContext<OfflineSync | null>(null)

export function useOptionalOfflineSync(): OfflineSync | null {
  return useContext(OfflineSyncContext)
}

function getCurrentGroupIdFromLocation(): string | null {
  try {
    if (typeof window === 'undefined') return null
    const match = window.location.pathname.match(/\/groups\/([^/]+)/)
    const id = match?.[1] ?? null
    if (!id || id === 'create' || id === 'import') return null
    return decodeURIComponent(id)
  } catch {
    return null
  }
}

export function useOptionalOfflineLifecycle(): OfflineLifecycle | null {
  return useContext(OfflineLifecycleContext)
}

export function useOptionalOfflineConnectivity(): ConnectivityStore | null {
  return useContext(OfflineConnectivityContext)
}

export function useOptionalOfflineStorage(): OfflineStore | null {
  return useContext(OfflineStorageContext)
}

function toSessionResult(
  data: { user?: unknown } | null,
  error: unknown,
): SessionFetchResult {
  if (data?.user && typeof data.user === 'object') {
    return { kind: 'verified', account: data.user as AuthAccount }
  }
  if (data === null && (error === null || error === undefined)) {
    // Successful get-session null revokes the read identity.
    return { kind: 'signed-out' }
  }
  if (error !== null && error !== undefined) {
    if (isNetworkError(error)) return { kind: 'network-failure', error }
    const status =
      (error as { status?: unknown }).status ??
      (error as { statusCode?: unknown }).statusCode ??
      (error as { data?: { httpStatus?: unknown } }).data?.httpStatus
    if (typeof status === 'number' && status >= 500 && status <= 599) {
      return { kind: 'server-failure', status }
    }
    // Non-network, non-5xx errors preserve the read identity (never infer a
    // verified session or a sign-out from a failed check).
    if (
      typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 400
    ) {
      return { kind: 'server-failure', status }
    }
    return { kind: 'network-failure', error }
  }
  return { kind: 'network-failure' }
}

export type OfflineProviderProps = {
  children: React.ReactNode
  lifecycle?: OfflineLifecycle
  connectivity?: ConnectivityStore
  storage?: OfflineStore
  sync?: OfflineSync | null
}

export function OfflineProvider(props: OfflineProviderProps) {
  const queryClientRef = useRef<{
    cancelQueries?: () => Promise<void>
    clear?: () => void
  } | null>(null)

  // Provider must mount inside TRPCProvider (which owns the QueryClient).
  const queryClientFromContext = useQueryClient() as unknown as {
    cancelQueries?: () => Promise<void>
    clear?: () => void
  }
  queryClientRef.current = queryClientFromContext

  const connectivity = useMemo(
    () => props.connectivity ?? getDefaultConnectivityStore(),
    [props.connectivity],
  )
  const storage = useMemo(
    () =>
      props.storage ??
      createOfflineStore({
        onStorageClose: () => {
          // Notify other tabs to close/reload IDB handles.
          try {
            const namespace =
              lifecycleRef.current?.getSnapshot().namespace ?? null
            if (!namespace) return
            channelRef.current?.post({
              type: 'storage-close',
              namespace,
              generation: lifecycleRef.current?.getSnapshot().generation ?? 0,
            })
          } catch {
            // Ignore broadcast failures.
          }
        },
      }),
    [props.storage],
  )

  const lifecycleRef = useRef<OfflineLifecycle | null>(null)
  const channelRef = useRef<ReturnType<typeof createOfflineChannel> | null>(
    null,
  )
  // Storage `onStorageClose` above closes over these refs, which are assigned
  // during the same render pass before any callback can fire.

  const lifecycle = useMemo(() => {
    if (props.lifecycle) return props.lifecycle
    if (lifecycleRef.current) return lifecycleRef.current

    const verifySession = async (
      signal: AbortSignal,
    ): Promise<SessionFetchResult> => {
      if (signal.aborted) return { kind: 'aborted' }
      try {
        // Credentialed, uncached verification with the approved 8s bound.
        // The lifecycle races this against its own timeout; this fetch uses
        // plain credentials (never disabled by the offline state it repairs).
        const result = await authClient.getSession({
          query: { disableCookieCache: true },
          fetchOptions: { signal },
        })
        if (signal.aborted) return { kind: 'aborted' }
        return toSessionResult(
          result.data as { user?: unknown } | null,
          result.error,
        )
      } catch (error) {
        if (signal.aborted) return { kind: 'aborted' }
        const name =
          error && typeof error === 'object' && 'name' in error
            ? String((error as { name: unknown }).name)
            : ''
        if (name === 'AbortError' || name === 'TimeoutError') {
          return { kind: 'aborted' }
        }
        if (isNetworkError(error)) return { kind: 'network-failure', error }
        return toSessionResult(null, error)
      }
    }

    const created = createOfflineLifecycle({
      readLastAccount,
      writeLastAccount,
      clearLastAccount,
      resolveNamespace: (accountId: string) =>
        buildNamespace(getApiBaseUrl(), accountId),
      verifySession,
      queryClient: {
        cancelQueries: () =>
          queryClientRef.current?.cancelQueries?.() ?? Promise.resolve(),
        clear: () => queryClientRef.current?.clear?.(),
      },
      navigate: (path: string) => {
        try {
          window.location.replace(path)
        } catch {
          // Navigation failures must not restore the session.
        }
      },
      storage: (() => {
        try {
          return typeof window === 'undefined' ? null : window.localStorage
        } catch {
          return null
        }
      })(),
      persisted: {
        clearWorkerMemory: () => {
          // Worker working set; no-op when no worker exists.
        },
        readControl: async (namespace: string) => {
          try {
            const repo = storage.getRepository()
            if (!repo) return null
            const control = await repo.readControl(namespace)
            if (!control) return null
            return { revoked: control.revoked, generation: control.generation }
          } catch {
            return null
          }
        },
        deleteNamespace: async (namespace: string, generation: number) => {
          const repo = storage.getRepository()
          // Storage unavailable: fencing (marker + generation) already ran
          // synchronously; there is nothing durable to delete.
          if (!repo) return
          await repo.revokeNamespace({ namespace, generation })
        },
        finishRevokedDeletion: async (namespace: string) => {
          const repo = storage.getRepository()
          if (!repo) return
          const control = await repo.readControl(namespace).catch(() => null)
          const generation = control?.generation ?? 0
          await repo
            .revokeNamespace({ namespace, generation })
            .catch(() => undefined)
        },
        resetLifecycle: async (namespace: string) => {
          const repo = storage.getRepository()
          if (!repo) {
            const current = lifecycleRef.current?.getSnapshot().generation ?? 0
            return { generation: current + 1 }
          }
          // Prefer an explicit reactivation when the repository supports it;
          // otherwise fall back to ensuring a control record exists and
          // fencing in-memory (durable dataRevision writes happen in the sync path).
          const maybe = repo as unknown as {
            reactivateNamespace?: (input: {
              namespace: string
            }) => Promise<{ generation: number }>
          }
          if (typeof maybe.reactivateNamespace === 'function') {
            return maybe.reactivateNamespace({ namespace })
          }
          const control = await repo.ensureControl(namespace).catch(() => null)
          const current =
            control?.generation ??
            lifecycleRef.current?.getSnapshot().generation ??
            0
          return { generation: current + 1 }
        },
        readEnabledPref: async (namespace: string) => {
          try {
            const repo = storage.getRepository()
            if (!repo) return null
            const control = await repo.readControl(namespace)
            return control ? control.enabled : null
          } catch {
            return null
          }
        },
      },
    })
    lifecycleRef.current = created
    return created
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- singleton per mount; queryClient read via ref.
  }, [props.lifecycle, connectivity, storage])

  // Keep the ref current when a test injects its own lifecycle.
  useEffect(() => {
    lifecycleRef.current = lifecycle
  }, [lifecycle])

  // Cross-tab channel: BroadcastChannel + storage-event fallback with nonce.
  // Deletion/fencing never depends on it (markers + IDB generation own that).
  useEffect(() => {
    if (props.lifecycle) return
    const channel = createOfflineChannel((event: OfflineChannelEvent) => {
      lifecycle.handleCrossTabEvent(event)
    })
    channelRef.current = channel
    return () => {
      channelRef.current = null
      channel.close()
    }
  }, [lifecycle, props.lifecycle])

  const syncRef = useRef<OfflineSync | null>(null)

  // Cold start: local restore displays first, then bounded verification;
  // storage opens in the background without blocking public/auth pages.
  useEffect(() => {
    let cancelled = false
    connectivity.start()
    void storage.open().catch(() => undefined)
    // Injected test lifecycles bootstrap like production ones; bootstrap is
    // idempotent so StrictMode remounts stay safe.
    void lifecycle.bootstrap().catch(() => undefined)
    // On focus, recheck the control record even if messages were missed.
    const handleFocus = () => {
      void lifecycle.recheckOnFocus().catch(() => undefined)
      // Foreground return refreshes downloads only when the last full pass
      // is older than 5min (sync owns the rule, never polls while active).
      try {
        void syncRef.current?.handleForeground().catch(() => undefined)
      } catch {
        // Ignore foreground refresh failures.
      }
    }
    const handleVisibility = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
      ) {
        void lifecycle.recheckOnFocus().catch(() => undefined)
        try {
          void syncRef.current?.handleForeground().catch(() => undefined)
        } catch {
          // Ignore foreground refresh failures.
        }
      }
    }
    window.addEventListener('focus', handleFocus)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility)
    }
    return () => {
      cancelled = true
      void cancelled
      window.removeEventListener('focus', handleFocus)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility)
      }
      connectivity.stop()
    }
  }, [connectivity, lifecycle, storage])

  // Keep TanStack's online state in agreement with transport. Probe/auth
  // fetches use plain fetch / networkMode:'always' paths so they are never
  // disabled by the same offline state they repair.
  const getTransport = useCallback(
    () => connectivity.getSnapshot().transport,
    [connectivity],
  )
  const transport = useSyncExternalStore(
    connectivity.subscribe,
    getTransport,
    getTransport,
  )
  useEffect(() => {
    try {
      onlineManager.setOnline(transport !== 'unreachable')
    } catch {
      // Ignore online-manager failures in tests without a client.
    }
  }, [transport])

  // Forward 401/UNAUTHORIZED query + mutation failures to session
  // verification (P1-1). FORBIDDEN is excluded inside notifyAuthError (group
  // permission, not session). Single-flight lives in the lifecycle.
  useEffect(() => {
    const client = queryClientFromContext as unknown as {
      getQueryCache?: () => {
        subscribe?: (listener: (event: unknown) => void) => () => void
      }
      getMutationCache?: () => {
        subscribe?: (listener: (event: unknown) => void) => () => void
      }
    } | null
    if (!client) return
    const unsubscribes: Array<() => void> = []
    const forward = (error: unknown) => {
      try {
        lifecycle.notifyAuthError(error)
      } catch {
        // Notification must never break query handling.
      }
    }
    const errorFromUpdate = (event: unknown): unknown => {
      if (!event || typeof event !== 'object') return null
      const record = event as {
        type?: unknown
        action?: { type?: unknown; error?: unknown }
      }
      if (record.type !== 'updated') return null
      if (record.action?.type !== 'error') return null
      return record.action.error ?? null
    }
    try {
      const unsubQuery = client
        .getQueryCache?.()
        ?.subscribe?.((event: unknown) => {
          const error = errorFromUpdate(event)
          if (error !== null && error !== undefined) forward(error)
        })
      if (unsubQuery) unsubscribes.push(unsubQuery)
    } catch {
      // Ignore subscription failures in tests without a full client.
    }
    try {
      const unsubMutation = client
        .getMutationCache?.()
        ?.subscribe?.((event: unknown) => {
          const error = errorFromUpdate(event)
          if (error !== null && error !== undefined) forward(error)
        })
      if (unsubMutation) unsubscribes.push(unsubMutation)
    } catch {
      // Ignore subscription failures in tests without a full client.
    }
    return () => {
      for (const unsub of unsubscribes) {
        try {
          unsub()
        } catch {
          // Ignore teardown failures.
        }
      }
    }
  }, [lifecycle, queryClientFromContext])

  const getAccountId = useCallback(
    () => lifecycle.getSnapshot().account?.id ?? null,
    [lifecycle],
  )
  const accountId = useSyncExternalStore(
    lifecycle.subscribe,
    getAccountId,
    getAccountId,
  )

  // --- Offline sync engine ----------------------
  // Per-namespace sync: verify session + dedicated unbatched download
  // fetchers, lease-fenced commits via replaceCatalog/commitGroup inside
  // sync.ts. Loser tabs read committed results. Created only when a device
  // identity (namespace) and a usable repository exist; disposed on
  // namespace change/unmount so old-account passes never commit.
  const getLifecycleSnapshotForSync = useCallback(
    () => lifecycle.getSnapshot(),
    [lifecycle],
  )
  const lifecycleSnapshotForSync = useSyncExternalStore(
    lifecycle.subscribe,
    getLifecycleSnapshotForSync,
    getLifecycleSnapshotForSync,
  )
  const syncNamespace = lifecycleSnapshotForSync.namespace
  const getStorageSnapshotForSync = useCallback(
    () => storage.getSnapshot(),
    [storage],
  )
  const storageSnapshotForSync = useSyncExternalStore(
    storage.subscribe,
    getStorageSnapshotForSync,
    getStorageSnapshotForSync,
  )
  void storageSnapshotForSync
  const repositoryForSync = (() => {
    try {
      return storage.getRepository()
    } catch {
      return null
    }
  })()

  const sync = useMemo(() => {
    if (props.sync !== undefined) return props.sync
    if (!syncNamespace || !repositoryForSync) return null
    const namespace = syncNamespace
    const repository = repositoryForSync
    const fetchers = createOfflineDownloadFetchers()
    const verify: SyncVerifyFn = async (signal) => {
      if (signal.aborted) return false
      try {
        const result = await authClient.getSession({
          query: { disableCookieCache: true },
          fetchOptions: { signal },
        })
        if (signal.aborted) return false
        const mapped = toSessionResult(
          result.data as { user?: unknown } | null,
          result.error,
        )
        return mapped.kind === 'verified'
      } catch (error) {
        if (signal.aborted) return false
        const name =
          error && typeof error === 'object' && 'name' in error
            ? String((error as { name: unknown }).name)
            : ''
        if (name === 'AbortError' || name === 'TimeoutError') return false
        return false
      }
    }
    const created = createOfflineSync({
      namespace,
      repository,
      verifySession: verify,
      fetchCatalog: fetchers.fetchCatalog,
      fetchSnapshot: fetchers.fetchSnapshot,
      getCurrentGroupId: getCurrentGroupIdFromLocation,
      broadcast: (event) => {
        try {
          channelRef.current?.post({
            type: event.type,
            namespace: event.namespace,
            generation: event.generation,
            ...(event.groupId ? { groupId: event.groupId } : {}),
          })
        } catch {
          // Broadcast failures never block fencing.
        }
        try {
          const qc = queryClientRef.current as unknown as {
            invalidateQueries?: (opts: unknown) => Promise<unknown>
          } | null
          void qc?.invalidateQueries?.({
            queryKey: ['offline', namespace],
          })
        } catch {
          // Ignore invalidation failures.
        }
        try {
          window.localStorage.setItem(
            'spliit:offline:event',
            JSON.stringify({
              ...event,
              nonce: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
            }),
          )
        } catch {
          // Ignore broadcast failures.
        }
      },
      onConnectivityFailure: (error) => {
        try {
          connectivity.reportNetworkFailure(error)
        } catch {
          // Ignore mirror failures.
        }
      },
      isConnectivityError: (cause) => {
        try {
          return isTransportFailure(cause)
        } catch {
          return false
        }
      },
    })
    return created
  }, [
    props.sync,
    syncNamespace,
    // Repository identity is stable while available; status changes recreate
    // the engine when storage opens. eslint reads the snapshot above.
    repositoryForSync,
    connectivity,
  ])

  useEffect(() => {
    syncRef.current = sync
  }, [sync])

  // Dispose per-namespace engines so old-account passes never commit after
  // a switch. Injected test syncs are owned by the test and never disposed.
  useEffect(() => {
    if (props.sync !== undefined) return
    const owned = sync
    if (!owned) return
    return () => {
      try {
        owned.dispose()
      } catch {
        // Ignore disposal failures.
      }
    }
  }, [sync, props.sync])

  return (
    <OfflineLifecycleContext.Provider value={lifecycle}>
      <OfflineConnectivityContext.Provider value={connectivity}>
        <OfflineStorageContext.Provider value={storage}>
          <OfflineSyncContext.Provider value={sync}>
            {/* Remount account content on identity change so A stops rendering
               synchronously; stores/listeners above stay mounted. */}
            <div
              key={accountId ?? 'signed-out'}
              style={{ display: 'contents' }}
            >
              {props.children}
            </div>
          </OfflineSyncContext.Provider>
        </OfflineStorageContext.Provider>
      </OfflineConnectivityContext.Provider>
    </OfflineLifecycleContext.Provider>
  )
}

const EMPTY_SUBSCRIBE = () => () => {}
const EMPTY_LIFECYCLE_SNAPSHOT = {
  account: null,
  session: 'signed-out' as const,
  namespace: null,
  generation: 0,
  cleanupError: null,
  invalidated: false,
  lastVerifiedAt: null,
  verifyAttempt: 0,
}
function getEmptyLifecycleSnapshot() {
  return EMPTY_LIFECYCLE_SNAPSHOT
}

/** Session + transport snapshot for the write guard (reads only). */
export function useOfflineSession(): {
  account: AuthAccount | null
  session: 'checking' | 'verified' | 'offline-identity' | 'signed-out'
  transport: 'unknown' | 'reachable' | 'unreachable'
  namespace: string | null
  generation: number
  cleanupError: string | null
} {
  const lifecycle = useOptionalOfflineLifecycle()
  const connectivityFromContext = useOptionalOfflineConnectivity()
  const connectivity = useMemo(
    () => connectivityFromContext ?? getDefaultConnectivityStore(),
    [connectivityFromContext],
  )
  const lifecycleSnapshot = useSyncExternalStore(
    lifecycle?.subscribe ?? EMPTY_SUBSCRIBE,
    lifecycle?.getSnapshot ?? getEmptyLifecycleSnapshot,
    lifecycle?.getSnapshot ?? getEmptyLifecycleSnapshot,
  )
  const getTransport = useCallback(
    () => connectivity.getSnapshot().transport,
    [connectivity],
  )
  const transport = useSyncExternalStore(
    connectivity.subscribe,
    getTransport,
    getTransport,
  )
  return {
    account: lifecycleSnapshot.account,
    session: lifecycleSnapshot.session,
    transport,
    namespace: lifecycleSnapshot.namespace,
    generation: lifecycleSnapshot.generation,
    cleanupError: lifecycleSnapshot.cleanupError,
  }
}

/**
 * Write eligibility (verified + reachable). Permission revalidation for the
 * visible screen happens after verification; unrelated downloads never block
 * the revalidated screen. The write guard enforces this before side effects —
 * this hook only exposes state, never guards.
 */
export function useOfflineWriteEligibility(): {
  eligible: boolean
  reason: 'verified' | 'session' | 'transport'
} {
  const { session, transport } = useOfflineSession()
  if (session !== 'verified') return { eligible: false, reason: 'session' }
  if (transport !== 'reachable') return { eligible: false, reason: 'transport' }
  return { eligible: true, reason: 'verified' }
}

/**
 * After verification, refetch visible permissions before enabling actions.
 * Refetches only the visible screen's `groups.get` / `expenses.get`
 * permission/version queries (server authoritative); offline download keys
 * (`['offline', ...]`) are never awaited so unrelated downloads cannot block
 * the revalidated screen. Exposes pending state for write gating.
 */
export function useRevalidateVisiblePermissions(): {
  revalidate: (input?: {
    groupId?: string
    expenseId?: string
  }) => Promise<void>
  isRevalidating: boolean
} {
  const queryClient = useQueryClient() as unknown as {
    refetchQueries: (opts: {
      predicate?: (query: { queryKey: unknown }) => boolean
    }) => Promise<unknown>
  } | null
  const [isRevalidating, setIsRevalidating] = useState(false)
  const revalidate = useCallback(
    async (input?: { groupId?: string; expenseId?: string }) => {
      const visibleGroupId = input?.groupId ?? getCurrentGroupIdFromLocation()
      const visibleExpenseId = input?.expenseId
      setIsRevalidating(true)
      try {
        if (!queryClient?.refetchQueries) return
        await queryClient.refetchQueries({
          predicate: (query: { queryKey: unknown }) => {
            const key = query.queryKey as unknown[]
            if (!Array.isArray(key) || key.length === 0) return false
            // Offline downloads must never block permission revalidation.
            if (key[0] === 'offline') return false
            const serialized = (() => {
              try {
                return JSON.stringify(key)
              } catch {
                return ''
              }
            })()
            // Visible group scope: when a group is visible, only its
            // permission/version queries unblock writes. Without a visible
            // group, refetch any groups/expenses permission query (still
            // never offline keys).
            const isGroupsGet =
              serialized.includes('"groups"') && serialized.includes('"get"')
            const isExpensesGet =
              serialized.includes('"expenses"') && serialized.includes('"get"')
            if (!isGroupsGet && !isExpensesGet) return false
            if (visibleGroupId && !serialized.includes(visibleGroupId)) {
              return false
            }
            if (
              visibleExpenseId &&
              isExpensesGet &&
              !serialized.includes(visibleExpenseId)
            ) {
              return false
            }
            return true
          },
        })
      } finally {
        setIsRevalidating(false)
      }
    },
    [queryClient],
  )
  return { revalidate, isRevalidating }
}

const EMPTY_SYNC_STATUS: SyncStatusSnapshot = {
  phase: 'idle',
  isOwner: false,
  totalGroups: 0,
  readyGroups: 0,
  currentGroupId: null,
  currentGroupName: null,
  activity: null,
  errors: {},
  lastCompletedFullPassAt: null,
  earliestRetryAt: null,
  lastCatalogAt: null,
}
/**
 * Live sync status for status UI. Subscribes to the per-namespace engine;
 * without an engine (signed-out, storage unavailable) reports idle so compact
 * status falls back to inventory (partial) instead of fake downloading.
 */
export function useOptionalOfflineSyncStatus(): SyncStatusSnapshot | null {
  const sync = useOptionalOfflineSync()
  const subscribe = useCallback(
    (listener: () => void) => sync?.subscribe(listener) ?? (() => {}),
    [sync],
  )
  const getSnapshot = useCallback(
    () => sync?.getStatus() ?? EMPTY_SYNC_STATUS,
    [sync],
  )
  const status = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!sync) return null
  return status
}

/** Last completed full-pass timestamp for “last updated” (never catalog time). */
export function useOfflineLastCompletedFullPassAt(): number | null {
  const sync = useOptionalOfflineSync()
  const subscribe = useCallback(
    (listener: () => void) => sync?.subscribe(listener) ?? (() => {}),
    [sync],
  )
  const getSnapshot = useCallback(
    () => sync?.getLastCompletedFullPassAt() ?? null,
    [sync],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Authenticated sync triggers.
 *
 * Mount once inside `OfflineProvider` (see `AppShell`): launch on verified
 * identity, reconnect when transport recovers, foreground per the 5min rule.
 * Triggers coalesce into one active pass + one pending rerun, never overlapping
 * account passes. Returns null UI.
 */
export function OfflineSyncHost() {
  const lifecycle = useOptionalOfflineLifecycle()
  const connectivity =
    useOptionalOfflineConnectivity() ?? getDefaultConnectivityStore()
  const sync = useOptionalOfflineSync()
  const launchedRef = useRef<string | null>(null)
  const prevTransportRef = useRef<string | null>(null)
  const queryClientForMutations = useQueryClient() as unknown as {
    getMutationCache?: () => {
      subscribe?: (listener: (event: unknown) => void) => () => void
    }
  } | null

  const getLifecycleSnapshot = useCallback(
    () => lifecycle?.getSnapshot() ?? getEmptyLifecycleSnapshot(),
    [lifecycle],
  )
  const lifecycleSnapshot = useSyncExternalStore(
    lifecycle?.subscribe ?? EMPTY_SUBSCRIBE,
    getLifecycleSnapshot,
    getLifecycleSnapshot,
  )
  const getTransport = useCallback(
    () => connectivity.getSnapshot().transport,
    [connectivity],
  )
  const transport = useSyncExternalStore(
    connectivity.subscribe,
    getTransport,
    getTransport,
  )

  // Authenticated launch: verify, then download all catalog groups once.
  useEffect(() => {
    if (!sync || !lifecycle) return
    const namespace = lifecycleSnapshot.namespace
    if (!namespace) return
    if (lifecycleSnapshot.session !== 'verified') return
    if (launchedRef.current === namespace) return
    launchedRef.current = namespace
    void sync.handleLaunch().catch(() => undefined)
  }, [sync, lifecycle, lifecycleSnapshot.namespace, lifecycleSnapshot.session])

  // Successful reconnect auto path: after the recovery probe reports
  // reachable and session verification succeeds, download all groups.
  useEffect(() => {
    const prev = prevTransportRef.current
    prevTransportRef.current = transport
    if (!sync || !lifecycle) return
    if (prev !== 'unreachable' || transport !== 'reachable') return
    if (lifecycleSnapshot.session !== 'verified') return
    if (!lifecycleSnapshot.namespace) return
    void sync.handleReconnect().catch(() => undefined)
  }, [
    sync,
    lifecycle,
    transport,
    lifecycleSnapshot.session,
    lifecycleSnapshot.namespace,
  ])

  // Successful online mutation: schedule an offline refresh asynchronously
  // without delaying success. Extracts a resolvable groupId from mutation
  // variables when present; mutations without one request a full pass.
  // Group removals evict immediately via explicit callers; this forwarding
  // only schedules targeted refreshes and never delays mutation success.
  useEffect(() => {
    if (!sync || !queryClientForMutations) return
    let unsubscribe: (() => void) | null = null
    try {
      unsubscribe =
        queryClientForMutations
          .getMutationCache?.()
          ?.subscribe?.((event: unknown) => {
            try {
              if (!event || typeof event !== 'object') return
              const record = event as {
                type?: unknown
                action?: { type?: unknown; variables?: unknown }
              }
              if (record.type !== 'updated') return
              if (record.action?.type !== 'success') return
              const variables = record.action.variables as
                | { groupId?: unknown; groupIds?: unknown }
                | null
                | undefined
              const ids: string[] = []
              if (variables && typeof variables === 'object') {
                if (typeof variables.groupId === 'string') {
                  ids.push(variables.groupId)
                }
                if (Array.isArray(variables.groupIds)) {
                  for (const id of variables.groupIds) {
                    if (typeof id === 'string') ids.push(id)
                  }
                }
              }
              // Fire-and-forget: existing success stays immediate.
              void sync
                .handleMutationSuccess(
                  ids.length > 0 ? { groupIds: ids } : undefined,
                )
                .catch(() => undefined)
            } catch {
              // Notification must never break mutation handling.
            }
          }) ?? null
    } catch {
      // Ignore subscription failures.
    }
    return () => {
      try {
        unsubscribe?.()
      } catch {
        // Ignore teardown failures.
      }
    }
  }, [sync, queryClientForMutations])

  return null
}

/** Notify the sync engine of a successful online mutation (fire-and-forget). */
export function useNotifyOfflineMutation(): {
  notifyMutationSuccess: (input?: { groupIds?: string[] }) => void
} {
  const sync = useOptionalOfflineSync()
  const notifyMutationSuccess = useCallback(
    (input?: { groupIds?: string[] }) => {
      try {
        void sync?.handleMutationSuccess(input).catch(() => undefined)
      } catch {
        // Notification must never break mutation handling.
      }
    },
    [sync],
  )
  return { notifyMutationSuccess }
}

/**
 * Explicit recovery retry for status UI: probe, verify, then reconnect the sync
 * engine. Callers that need Refresh-now vs Retry-failed semantics should call
 * `sync.refreshNow()` / `sync.retryFailed()` directly via
 * `useOptionalOfflineSync()` after this probe succeeds.
 */
export function useOfflineRetry(): {
  retry: () => Promise<boolean>
} {
  const lifecycle = useOptionalOfflineLifecycle()
  const connectivity =
    useOptionalOfflineConnectivity() ?? getDefaultConnectivityStore()
  const sync = useOptionalOfflineSync()
  const retry = useCallback(async () => {
    const reachable = await connectivity.retryNow()
    if (reachable && lifecycle) {
      await lifecycle.verifySession().catch(() => undefined)
      const verified = lifecycle.getSnapshot().session === 'verified'
      if (verified && sync) {
        // Successful reconnect auto path: the pass
        // verifies again idempotently then downloads all groups.
        await sync.handleReconnect().catch(() => undefined)
      }
      return verified
    }
    return reachable
  }, [connectivity, lifecycle, sync])
  return { retry }
}

export { SESSION_VERIFY_TIMEOUT_MS }
