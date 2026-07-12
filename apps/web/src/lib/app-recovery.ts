const RECOVERY_ATTEMPT_KEY = 'spliit:asset-recovery-attempted'
const RECOVERY_EVENT = 'spliit:asset-recovery-required'
const RECOVERY_QUERY_PARAM = '__spliit_recovery'

let recoveryInstalled = false
let recoveryInProgress = false

function isAssetLoadError(value: unknown) {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : value && typeof value === 'object' && 'message' in value
          ? String(value.message)
          : ''

  return /ChunkLoadError|Loading chunk|dynamically imported module|modulepreload|Importing a module script failed/i.test(
    message,
  )
}

function isAppAssetTarget(target: EventTarget | null) {
  if (
    typeof HTMLScriptElement === 'undefined' ||
    !(target instanceof HTMLScriptElement)
  ) {
    return false
  }

  try {
    const url = new URL(target.src, window.location.href)
    return (
      url.origin === window.location.origin &&
      url.pathname.startsWith('/assets/')
    )
  } catch {
    return false
  }
}

function hasAttemptedRecovery() {
  try {
    return sessionStorage.getItem(RECOVERY_ATTEMPT_KEY) === '1'
  } catch {
    return false
  }
}

function markRecoveryAttempted() {
  try {
    sessionStorage.setItem(RECOVERY_ATTEMPT_KEY, '1')
  } catch {
    // Storage can be disabled (for example, in private browsing). The
    // in-memory guard still prevents duplicate reloads for this page.
  }
}

export function clearRecoveryAttempt() {
  try {
    sessionStorage.removeItem(RECOVERY_ATTEMPT_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}

async function updateServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  try {
    const registration = await navigator.serviceWorker.getRegistration()
    await registration?.update()
  } catch {
    // A failed update should not prevent the normal browser reload.
  }
}

export function reloadWithFreshDocument() {
  const url = new URL(window.location.href)
  url.searchParams.set(RECOVERY_QUERY_PARAM, String(Date.now()))
  window.location.replace(url)
}

function showRecoveryAction() {
  window.dispatchEvent(new CustomEvent(RECOVERY_EVENT))
}

async function recoverFromAssetError() {
  if (recoveryInProgress) return
  recoveryInProgress = true

  // A route chunk that was never visited cannot be recovered while offline.
  // Keep the current app and let the React notice explain the limitation;
  // retrying here would only create a reload loop and could evict useful
  // cached reads.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    showRecoveryAction()
    return
  }

  if (hasAttemptedRecovery()) {
    showRecoveryAction()
    return
  }

  markRecoveryAttempted()
  await updateServiceWorker()
  reloadWithFreshDocument()
}

/**
 * Installs one guarded listener for Vite's preload errors and browser-level
 * dynamic import failures. A single automatic recovery is attempted; a
 * second failure is surfaced to the user instead of causing a reload loop.
 */
export function installAppRecovery() {
  if (recoveryInstalled || typeof window === 'undefined') return
  recoveryInstalled = true

  // Keep the cache-busting marker out of the user's visible/shareable URL
  // once the browser has loaded the fresh document.
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.has(RECOVERY_QUERY_PARAM)) {
      url.searchParams.delete(RECOVERY_QUERY_PARAM)
      window.history.replaceState(null, '', url)
    } else {
      // A normal startup means any prior recovery completed successfully (or
      // the user opened a fresh page), so allow one new attempt if needed.
      clearRecoveryAttempt()
    }
  } catch {
    // Ignore malformed URLs and restricted history contexts.
  }

  const handlePreloadError = (event: Event) => {
    event.preventDefault()
    void recoverFromAssetError()
  }
  const handleError = (event: ErrorEvent) => {
    if (
      isAppAssetTarget(event.target) ||
      isAssetLoadError(event.error ?? event.message)
    ) {
      void recoverFromAssetError()
    }
  }
  const handleRejection = (event: PromiseRejectionEvent) => {
    if (isAssetLoadError(event.reason)) {
      void recoverFromAssetError()
    }
  }

  window.addEventListener('vite:preloadError', handlePreloadError)
  window.addEventListener('error', handleError)
  window.addEventListener('unhandledrejection', handleRejection)

  // Keep the guard set on the cache-busted document. If a lazy chunk fails
  // again later in this same page, show the recovery action instead of
  // starting another automatic reload loop. A normal browser refresh clears
  // it at the beginning of the next startup.
}

export function subscribeToRecoveryRequired(listener: () => void) {
  window.addEventListener(RECOVERY_EVENT, listener)
  return () => window.removeEventListener(RECOVERY_EVENT, listener)
}

/**
 * Clears only service-worker app-shell/code caches. IndexedDB query data is
 * deliberately untouched so a user can still read cached data after repair.
 */
export async function clearAppCachesAndServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(
        registrations.map((registration) => registration.unregister()),
      )
    } catch {
      // Continue clearing Cache Storage even if a registration is unavailable.
    }
  }

  if ('caches' in window) {
    try {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith('spliit-pages-') ||
              name.startsWith('spliit-code-') ||
              name.startsWith('workbox-precache-'),
          )
          .map((name) => caches.delete(name)),
      )
    } catch {
      // Cache Storage may be unavailable in restricted browser contexts.
    }
  }

  clearRecoveryAttempt()
}
