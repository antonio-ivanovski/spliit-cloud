import { useState } from 'react'

export function useRegisterSW() {
  const [needRefresh] = useState(false)
  const [offlineReady] = useState(false)
  return {
    needRefresh: [needRefresh, () => {}] as const,
    offlineReady: [offlineReady, () => {}] as const,
    updateServiceWorker: async () => {},
  }
}
