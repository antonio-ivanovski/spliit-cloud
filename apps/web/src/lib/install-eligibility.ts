/**
 * Install-promotion eligibility from genuine auth successes.
 *
 * The auto promotion modal appears only after a successful account creation or
 * sign-in in this tab (password, OAuth, magic link, passkey, or anonymous
 * flows, plus profile-completion landings that finish a fresh verification).
 * Restored sessions and background re-verifications never set this flag: it
 * lives in sessionStorage, so a new tab with a remembered cookie stays
 * ineligible while same-tab redirects (OAuth round-trips) and reloads keep it.
 * The always-available manual install helper bypasses it.
 */

export const INSTALL_ELIGIBLE_KEY = 'spliit-pwa-install-eligible'

type Listener = () => void

const listeners = new Set<Listener>()

function emit() {
  for (const listener of Array.from(listeners)) {
    try {
      listener()
    } catch {
      // Listener failures must not break auth flows.
    }
  }
}

export function subscribeInstallEligibility(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function sessionStore(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  if (storage) return storage
  if (typeof sessionStorage === 'undefined') return undefined
  return sessionStorage
}

/** Record a successful auth event for this tab. Never throws. */
export function markInstallEligible(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): void {
  try {
    sessionStore(storage)?.setItem(
      INSTALL_ELIGIBLE_KEY,
      new Date().toISOString(),
    )
  } catch {
    // Restricted storage must not break auth flows.
  }
  emit()
}

/** Whether this tab saw a successful auth event. Never throws. */
export function isInstallEligible(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): boolean {
  try {
    return sessionStore(storage)?.getItem(INSTALL_ELIGIBLE_KEY) !== null
  } catch {
    return false
  }
}

/** Test-only reset for the tab flag (listeners intentionally persist). */
export function clearInstallEligibility(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): void {
  try {
    sessionStore(storage)?.removeItem(INSTALL_ELIGIBLE_KEY)
  } catch {
    // Ignore teardown failures.
  }
  emit()
}
