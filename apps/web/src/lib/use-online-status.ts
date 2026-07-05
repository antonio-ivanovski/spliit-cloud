import { useEffect, useState } from 'react'

/**
 * Tracks the browser's online status.
 *
 * Combines `navigator.onLine` with the `online` / `offline` window events. Note
 * that `navigator.onLine` is unreliable on its own (returns true whenever the
 * device has a network interface, even without actual internet), so this hook
 * is best used for UI hints — individual network requests should still be
 * guarded by their own error handling.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return isOnline
}
