const MASCOT_SETTINGS_DISCOVERED_EVENT = 'spliit:mascot-settings-discovered'

export function mascotSettingsDiscoveredKey(accountId: string) {
  return `mascotSettingsDiscovered:${accountId}`
}

export function hasDiscoveredMascotSettings(accountId: string | undefined) {
  if (!accountId || typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(mascotSettingsDiscoveredKey(accountId)) === '1'
  } catch {
    return false
  }
}

export function markMascotSettingsDiscovered(accountId: string | undefined) {
  if (!accountId || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(mascotSettingsDiscoveredKey(accountId), '1')
    window.dispatchEvent(new Event(MASCOT_SETTINGS_DISCOVERED_EVENT))
  } catch {
    // Discovery is a local hint; a storage failure just keeps the chip visible.
  }
}

export function subscribeMascotSettingsDiscovered(callback: () => void) {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(MASCOT_SETTINGS_DISCOVERED_EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(MASCOT_SETTINGS_DISCOVERED_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}
