/**
 * True for browser-level connectivity failures, not HTTP 4xx/5xx. Used to keep
 * the last session and to show offline UI when `navigator.onLine` is still true
 * (DevTools service-worker offline, captive portals, …).
 */
const NETWORK_ERROR_RE =
  /failed to fetch|load failed|networkerror|err_internet_disconnected|err_network_changed|err_connection_refused|err_name_not_resolved/i

export function isNetworkError(error: unknown): boolean {
  let current: unknown = error
  for (
    let depth = 0;
    depth < 4 && current && typeof current === 'object';
    depth++
  ) {
    const name = 'name' in current ? String(current.name) : ''
    const message = 'message' in current ? String(current.message) : ''
    if (NETWORK_ERROR_RE.test(`${name} ${message}`)) return true
    current = 'cause' in current ? current.cause : undefined
  }
  return false
}
