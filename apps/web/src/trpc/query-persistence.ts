import type { QueryKey } from '@tanstack/react-query'
import type {
  AsyncStorage,
  PersistedClient,
  Persister,
} from '@tanstack/react-query-persist-client'

/** Read data is useful after a reload, but should never outlive a deployment. */
export const QUERY_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000

/**
 * Return a deployment-specific cache marker when one is available. Production
 * Vite entry scripts are content-hashed, so deriving the marker from the
 * current entry URL also works for deployments that do not inject a version
 * environment variable. The unversioned fallback is intentionally stable in
 * dev only; production deployments should provide one of the env values.
 */
function getBuildIdentifier(): string {
  const configured =
    import.meta.env.VITE_APP_VERSION ??
    import.meta.env.VITE_BUILD_ID ??
    import.meta.env.VITE_COMMIT_SHA
  if (configured) return configured.replace(/[^a-zA-Z0-9_-]/g, '_')

  if (typeof document !== 'undefined') {
    const scriptSources = Array.from(
      document.querySelectorAll<HTMLScriptElement>('script[src]'),
    ).map((script) => script.src)
    for (const source of scriptSources) {
      const fileName = source.split('/').pop() ?? ''
      const match = fileName.match(/[-.]([a-zA-Z0-9_-]{8,})\.js(?:\?|$)/)
      if (match?.[1]) return match[1]
    }
  }

  return import.meta.env.MODE === 'development' ? 'dev' : 'unversioned'
}

export const QUERY_CACHE_BUSTER = `read-cache-${getBuildIdentifier()}`

const DATABASE_NAME = 'spliit-query-cache'
const DATABASE_VERSION = 1
const STORE_NAME = 'cache'
const STORAGE_KEY = 'client'
const ACCOUNT_MARKER_KEY = 'spliit:query-cache:account'
const ACCOUNT_SNAPSHOT_KEY = 'spliit:query-cache:account-snapshot'

export type StoredAccountSnapshot = {
  account: Record<string, unknown>
  accountId: string
  savedAt: number
  expiresAt: number
  buster: string
}

/**
 * tRPC v11 stores paths as the first item in a query key, e.g.
 * `[['groups', 'get'], { input, type: 'query' }]`.
 * Keep this allowlist deliberately small: persisted data is only a read
 * placeholder and must not include credentials, forms, or mutation state.
 */
export function shouldPersistQueryKey(queryKey: QueryKey): boolean {
  const path = queryKey[0]
  if (!Array.isArray(path) || path.some((part) => typeof part !== 'string')) {
    return false
  }

  const metadata = queryKey[1]
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    !('type' in metadata) ||
    (metadata.type !== 'query' && metadata.type !== 'infinite')
  ) {
    return false
  }

  // Link-invite tokens are credentials carried in query input. Never write a
  // token-bearing result or its query key to persistent storage, regardless of
  // which allowlisted procedure happens to carry the input.
  if (containsNonEmptyLinkInviteToken(queryKey)) return false

  return (
    (path.length === 2 && path[0] === 'account' && path[1] === 'groups') ||
    (path.length === 2 && path[0] === 'groups' && path[1] === 'get') ||
    (path.length === 3 &&
      path[0] === 'groups' &&
      path[1] === 'expenses' &&
      path[2] === 'list')
  )
}

function containsNonEmptyLinkInviteToken(
  value: unknown,
  seen = new Set<object>(),
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsNonEmptyLinkInviteToken(item, seen))
  }
  if (!value || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)

  if ('linkInviteToken' in value) {
    const token = (value as { linkInviteToken?: unknown }).linkInviteToken
    if (typeof token === 'string' ? token.length > 0 : Boolean(token))
      return true
  }

  return Object.values(value).some((item) =>
    containsNonEmptyLinkInviteToken(item, seen),
  )
}

export function shouldDehydrateReadQuery(query: {
  queryKey: QueryKey
  state: { status: string }
}) {
  return (
    query.state.status === 'success' && shouldPersistQueryKey(query.queryKey)
  )
}

function isIndexedDbAvailable() {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB error'))
  })
}

function createIndexedDbStorage(): AsyncStorage<string> {
  return {
    async getItem(key) {
      if (!isIndexedDbAvailable()) return undefined
      const database = await openDatabase()
      try {
        return await new Promise<string | undefined>((resolve, reject) => {
          const request = database
            .transaction(STORE_NAME, 'readonly')
            .objectStore(STORE_NAME)
            .get(key)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      } finally {
        database.close()
      }
    },
    async setItem(key, value) {
      if (!isIndexedDbAvailable()) return
      const database = await openDatabase()
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(STORE_NAME, 'readwrite')
          transaction.objectStore(STORE_NAME).put(value, key)
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () => reject(transaction.error)
        })
      } finally {
        database.close()
      }
    },
    async removeItem(key) {
      if (!isIndexedDbAvailable()) return
      const database = await openDatabase()
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(STORE_NAME, 'readwrite')
          transaction.objectStore(STORE_NAME).delete(key)
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () => reject(transaction.error)
        })
      } finally {
        database.close()
      }
    },
  }
}

const storage = createIndexedDbStorage()

/** Persister used by PersistQueryClientProvider. It is a no-op outside browsers. */
export const queryCachePersister: Persister = {
  async persistClient(client: PersistedClient) {
    try {
      await storage.setItem(STORAGE_KEY, JSON.stringify(client))
    } catch {
      // Storage can be disabled or evicted. The app remains fully network-backed.
    }
  },
  async restoreClient() {
    try {
      const value = await storage.getItem(STORAGE_KEY)
      return value ? (JSON.parse(value) as PersistedClient) : undefined
    } catch {
      return undefined
    }
  },
  async removeClient() {
    try {
      await storage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore unavailable/evicted storage.
    }
  },
}

export function getStoredAccountId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(ACCOUNT_MARKER_KEY)
  } catch {
    return null
  }
}

export function setStoredAccountId(accountId: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (accountId) window.localStorage.setItem(ACCOUNT_MARKER_KEY, accountId)
    else window.localStorage.removeItem(ACCOUNT_MARKER_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}

function canUseLocalStorage() {
  if (typeof window === 'undefined') return false
  try {
    return typeof window.localStorage !== 'undefined'
  } catch {
    return false
  }
}

function isAccountSnapshot(value: unknown): value is StoredAccountSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<StoredAccountSnapshot>
  return (
    typeof snapshot.accountId === 'string' &&
    typeof snapshot.savedAt === 'number' &&
    typeof snapshot.expiresAt === 'number' &&
    typeof snapshot.buster === 'string' &&
    Boolean(snapshot.account) &&
    typeof snapshot.account === 'object' &&
    typeof (snapshot.account as { id?: unknown }).id === 'string' &&
    typeof (snapshot.account as { name?: unknown }).name === 'string' &&
    typeof (snapshot.account as { email?: unknown }).email === 'string'
  )
}

/** Save only a server-confirmed account, never a token or session envelope. */
export function storeConfirmedAccount(account: unknown) {
  if (!canUseLocalStorage() || !account || typeof account !== 'object') return
  const accountRecord = account as Record<string, unknown>
  if (typeof accountRecord.id !== 'string') return
  const now = Date.now()
  const snapshot: StoredAccountSnapshot = {
    account: accountRecord,
    accountId: accountRecord.id,
    savedAt: now,
    expiresAt: now + QUERY_CACHE_MAX_AGE,
    buster: QUERY_CACHE_BUSTER,
  }
  try {
    window.localStorage.setItem(ACCOUNT_SNAPSHOT_KEY, JSON.stringify(snapshot))
    setStoredAccountId(snapshot.accountId)
  } catch {
    // Ignore unavailable/evicted storage.
  }
}

/** Return the last confirmed account only while it belongs to this build. */
export function getStoredAccountSnapshot(): StoredAccountSnapshot | null {
  if (!canUseLocalStorage()) return null
  try {
    const raw = window.localStorage.getItem(ACCOUNT_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      !isAccountSnapshot(parsed) ||
      parsed.buster !== QUERY_CACHE_BUSTER ||
      parsed.expiresAt <= Date.now()
    ) {
      window.localStorage.removeItem(ACCOUNT_SNAPSHOT_KEY)
      return null
    }
    const account = { ...parsed.account }
    for (const key of ['createdAt', 'updatedAt']) {
      const value = account[key]
      if (typeof value === 'string') account[key] = new Date(value)
    }
    return { ...parsed, account }
  } catch {
    return null
  }
}

export function clearStoredAccountSnapshot() {
  if (!canUseLocalStorage()) return
  try {
    window.localStorage.removeItem(ACCOUNT_SNAPSHOT_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}

export async function clearPersistedQueryCache() {
  await queryCachePersister.removeClient()
  clearStoredAccountSnapshot()
}
