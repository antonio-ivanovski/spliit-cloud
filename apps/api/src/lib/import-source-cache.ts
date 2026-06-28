import type { NormalizedSource } from '@spliit/domain/import'

const MAX_ENTRIES = 256
const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 minutes

type CacheEntry = {
  source: NormalizedSource
  expiresAt: number
}

const store: Map<string, CacheEntry> = new Map()

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

export function getCachedSource(
  sourceGroupId: string,
): NormalizedSource | null {
  const now = Date.now()
  evictExpired(now)
  const entry = store.get(sourceGroupId)
  if (!entry) return null
  if (entry.expiresAt <= now) {
    store.delete(sourceGroupId)
    return null
  }
  return entry.source
}

export function setCachedSource(
  sourceGroupId: string,
  source: NormalizedSource,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  store.set(sourceGroupId, {
    source,
    expiresAt: Date.now() + ttlMs,
  })
  enforceCapacity()
}

export function clearSourceCache(): void {
  store.clear()
}

/**
 * Test/utility export. Reports the current entry count after TTL
 * eviction so admin tooling can surface cache health.
 */
export function sourceCacheSize(): number {
  evictExpired(Date.now())
  return store.size
}
