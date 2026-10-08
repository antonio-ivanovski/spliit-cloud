/**
 * One-shot persistent-storage request after verified use.
 *
 * Installed/persisted storage survives quota pressure that would otherwise
 * evict IndexedDB and caches. The request goes out at most once per device
 * (marker-guarded) and only on recognized Chromium-based engines where
 * `persist()` resolves silently: Firefox prompts the user (skipped) and unknown
 * engines are skipped rather than probed. Denied/unsupported outcomes are
 * nonblocking by design. A successful PWA install clears the marker so Chrome
 * gets one more chance to grant persistence when it matters most.
 */

export const PWA_PERSIST_ATTEMPT_KEY = 'spliit:storage-persist-attempted'

export type PersistenceBrand = {
  brand?: string
  version?: string
}

export type PersistenceEnvironment = {
  userAgent?: string
  brands?: PersistenceBrand[] | null
}

/**
 * True only for recognized Chromium-based engines with silent approval. Firefox
 * (explicit prompt), Safari/WebKit (no reliable persist), and anything
 * unrecognized are skipped.
 */
export function isPersistenceWorthRequesting(
  environment: PersistenceEnvironment = {},
): boolean {
  const brands = environment.brands
  if (brands && brands.length > 0) {
    const names = brands.map((entry) => (entry.brand ?? '').toLowerCase())
    const chromium = names.some((name) =>
      [
        'chromium',
        'google chrome',
        'chrome',
        'microsoft edge',
        'edge',
        'opera',
        'samsung internet',
        'brave',
      ].some((known) => name.includes(known)),
    )
    const blocked = names.some(
      (name) => name.includes('firefox') || name.includes('safari'),
    )
    return chromium && !blocked
  }
  const agent = (environment.userAgent ?? '').toLowerCase()
  if (!agent) return false
  if (agent.includes('firefox') || agent.includes('fxios')) return false
  // Safari (desktop and iOS): Version/... Safari tokens without Chrome.
  if (agent.includes('safari') && !agent.includes('chrome')) return false
  return agent.includes('chrome') || agent.includes('edg')
}

export type PersistentStorageHost = {
  persist?: () => Promise<boolean>
}

export type PersistenceMarkerStorage = Pick<Storage, 'getItem' | 'setItem'> &
  Partial<Pick<Storage, 'removeItem'>>

export type PersistenceRequestDeps = {
  environment?: PersistenceEnvironment
  storage?: PersistenceMarkerStorage | undefined
  navigatorRef?: { storage?: PersistentStorageHost | undefined } | undefined
}

export type PersistenceRequestOutcome =
  | 'persisted'
  | 'declined'
  | 'unsupported'
  | 'skipped'
  | 'already'

/**
 * Request persistent storage exactly once. Never throws: every outcome maps to
 * a status and the attempt marker is written before resolving so no path
 * retries or re-prompts (except an explicit post-install retry via
 * `clearPersistenceAttempt`, which removes the marker after `appinstalled`).
 */
export async function ensurePersistentStorageOnce(
  deps: PersistenceRequestDeps = {},
): Promise<PersistenceRequestOutcome> {
  let attempted = false
  try {
    attempted =
      (deps.storage?.getItem(PWA_PERSIST_ATTEMPT_KEY) ?? null) !== null
  } catch {
    attempted = false
  }
  if (attempted) return 'already'
  const markAttempted = () => {
    try {
      deps.storage?.setItem(PWA_PERSIST_ATTEMPT_KEY, '1')
    } catch {
      // Marker failures must not block or retry the request itself.
    }
  }
  if (!isPersistenceWorthRequesting(deps.environment ?? {})) {
    markAttempted()
    return 'skipped'
  }
  const storageHost = deps.navigatorRef?.storage
  if (typeof storageHost?.persist !== 'function') {
    markAttempted()
    return 'unsupported'
  }
  markAttempted()
  try {
    // Call as a method so the StorageManager receiver is preserved.
    // A destructured `persist()` throws "Illegal invocation" in Chrome.
    return (await storageHost.persist()) ? 'persisted' : 'declined'
  } catch {
    return 'declined'
  }
}

/**
 * Clear the once-per-device marker so a later trigger (PWA `appinstalled`, when
 * Chrome is most likely to grant persistence) gets one more attempt. Tolerates
 * marker stores without `removeItem`. Never throws.
 */
export function clearPersistenceAttempt(
  storage?: PersistenceMarkerStorage,
): void {
  try {
    storage?.removeItem?.(PWA_PERSIST_ATTEMPT_KEY)
  } catch {
    // Marker clearing must never break the install transition.
  }
}

/** Browser environment for the default wiring (main thread only). */
export function defaultPersistenceEnvironment(): PersistenceEnvironment {
  if (typeof navigator === 'undefined') return {}
  const data = navigator as Navigator & {
    userAgentData?: { brands?: PersistenceBrand[] } | null
  }
  return {
    userAgent: navigator.userAgent,
    brands: data.userAgentData?.brands ?? null,
  }
}
