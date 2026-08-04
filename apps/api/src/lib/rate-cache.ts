/** Dumb in-process TTL cache for currency rates. No domain / provider logic. */

const MAX_ENTRIES = 256

type CacheEntry<T> = {
  value: T
  expiresAt: number
}

const store: Map<string, CacheEntry<unknown>> = new Map()

export function rateCacheKey(base: string, target: string, date: string) {
  return `${date}|${base}|${target}`
}

function evictExpired(now: number) {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key)
  }
}

function enforceCapacity() {
  while (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value as string | undefined
    if (!oldestKey) break
    store.delete(oldestKey)
  }
}

export function readRateCache<T>(key: string): T | null {
  const now = Date.now()
  evictExpired(now)
  const entry = store.get(key)
  if (!entry) return null
  if (entry.expiresAt <= now) {
    store.delete(key)
    return null
  }
  return entry.value as T
}

export function writeRateCache<T>(key: string, value: T, ttlMs: number) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
  enforceCapacity()
}

export function clearRateCache() {
  store.clear()
}

export function rateCacheSize() {
  evictExpired(Date.now())
  return store.size
}
