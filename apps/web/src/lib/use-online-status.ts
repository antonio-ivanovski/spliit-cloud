import { useEffect, useState } from 'react'

import {
  hasFetchNetworkFailure,
  reportNetworkSuccess,
  subscribeConnectivity,
} from '@/lib/connectivity'

/**
 * Tracks whether the app can reach the network.
 *
 * Combines `navigator.onLine` with a latch set when fetch throws a connectivity
 * error. DevTools "service worker offline" often leaves `navigator.onLine` true
 * while API calls fail, so the latch is what surfaces the offline banner.
 */
export function useOnlineStatus(): boolean {
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
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

  return browserOnline && !fetchFailed
}

/**
 * True when the shell is offline and this view has no in-session data. Used to
 * show an honest empty state instead of a spinner, generic error, or pretending
 * cached groups/expenses are available.
 */
export function useOfflineWithoutData(hasData: boolean): boolean {
  return !useOnlineStatus() && !hasData
}
