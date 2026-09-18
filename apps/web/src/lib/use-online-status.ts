import { useConnectivityOnlineStatus } from '@/lib/offline/connectivity'

/**
 * Compatibility projection of the shared offline transport store.
 *
 * Previously this hook owned its own `navigator.onLine` + fetch-failure latch.
 * It now projects `transport !== 'unreachable'` plus a synchronous
 * `navigator.onLine` hint (so a freshly-set `navigator.onLine === false`
 * reports offline even before the store's `offline` event fires). The shared
 * store owns all event listeners and recovery probes; this hook adds none.
 */
export function useOnlineStatus(): boolean {
  return useConnectivityOnlineStatus()
}

/**
 * True when the shell is offline and this view has no in-session data. Used to
 * show an honest empty state instead of a spinner, generic error, or pretending
 * cached groups/expenses are available.
 */
export function useOfflineWithoutData(hasData: boolean): boolean {
  return !useOnlineStatus() && !hasData
}
