import { useEffect, useState } from 'react'

import {
  hasFetchNetworkFailure,
  reportNetworkSuccess,
  subscribeConnectivity,
} from '@/lib/connectivity'

export type ConnectivityStatus = 'online' | 'offline' | 'server-unreachable'

function readBrowserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

/**
 * Tri-state connectivity.
 *
 * - `offline`: the browser itself reports no connection (`navigator.onLine` is
 *   false). The user really is offline.
 * - `server-unreachable`: the browser thinks it is online, but API `fetch` calls
 *   keep failing (thrown connectivity errors) or return 5xx. The user is online
 *   — the API is down.
 * - `online`: everything works.
 *
 * DevTools "service worker offline" often leaves `navigator.onLine` true while
 * API calls fail, which is why the fetch-failure latch exists — but a latched
 * failure with an online browser must never be reported as the user being
 * offline.
 */
export function useConnectivityStatus(): ConnectivityStatus {
  const [browserOnline, setBrowserOnline] = useState<boolean>(readBrowserOnline)
  const [fetchFailed, setFetchFailed] = useState(hasFetchNetworkFailure)

  useEffect(() => {
    const handleOnline = () => {
      reportNetworkSuccess()
      setBrowserOnline(true)
    }
    const handleOffline = () => setBrowserOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    const unsubscribe = subscribeConnectivity(() => {
      setFetchFailed(hasFetchNetworkFailure())
    })

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      unsubscribe()
    }
  }, [])

  if (!browserOnline) return 'offline'
  if (fetchFailed) return 'server-unreachable'
  return 'online'
}

/**
 * Whether the app can currently reach the API (browser online and no recent
 * fetch/server failure). Use for enabling queries and mutations — not for
 * choosing offline copy, where {@link useConnectivityStatus} distinguishes "you
 * are offline" from "the server is down".
 *
 * Combines `navigator.onLine` with a latch set when auth/tRPC `fetch` throws a
 * connectivity error or returns a 5xx.
 */
export function useOnlineStatus(): boolean {
  return useConnectivityStatus() === 'online'
}

/**
 * True when the shell is offline and this view has no in-session data. Used to
 * show an honest empty state instead of a spinner, generic error, or pretending
 * cached groups/expenses are available.
 */
export function useOfflineWithoutData(hasData: boolean): boolean {
  return useConnectivityStatus() === 'offline' && !hasData
}

/**
 * True when the browser is online but the API cannot be reached (connection
 * failures or 5xx) and this view has no in-session data. Pair with
 * {@link useOfflineWithoutData}: one of them is true at most, never both.
 */
export function useServerUnreachableWithoutData(hasData: boolean): boolean {
  return useConnectivityStatus() === 'server-unreachable' && !hasData
}
