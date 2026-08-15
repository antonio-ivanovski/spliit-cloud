import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

import { subscribeServiceWorkerUpdateChecks } from '@/lib/pwa-update-checks'

let unsubscribeUpdateChecks: (() => void) | undefined

/**
 * Registers the injectManifest worker and reloads only after a new worker has
 * finished precaching, so the running page never mixes two Vite graphs.
 */
export function PwaRegister() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      unsubscribeUpdateChecks?.()
      if (!registration) return
      unsubscribeUpdateChecks = subscribeServiceWorkerUpdateChecks(registration)
    },
  })

  useEffect(() => {
    if (needRefresh) void updateServiceWorker(true)
  }, [needRefresh, updateServiceWorker])

  return null
}
