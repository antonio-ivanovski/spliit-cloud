const MASCOT_ACTIONS_DISCOVERED_EVENT = 'spliit:mascot-actions-discovered'

export function mascotActionsDiscoveredKey(accountId: string) {
  return `mascotActionsDiscovered:${accountId}`
}

export function hasDiscoveredMascotActions(accountId: string | undefined) {
  if (!accountId || typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(mascotActionsDiscoveredKey(accountId)) === '1'
  } catch {
    return false
  }
}

export function markMascotActionsDiscovered(accountId: string | undefined) {
  if (!accountId || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(mascotActionsDiscoveredKey(accountId), '1')
    window.dispatchEvent(new Event(MASCOT_ACTIONS_DISCOVERED_EVENT))
  } catch {
    // Discovery is a local hint; a storage failure just keeps the coach visible.
  }
}

export function subscribeMascotActionsDiscovered(callback: () => void) {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(MASCOT_ACTIONS_DISCOVERED_EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(MASCOT_ACTIONS_DISCOVERED_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}
