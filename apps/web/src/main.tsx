import '@/app/globals.css'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { initI18n } from '@/i18n/setup'
import { initPwaAppMode } from '@/lib/pwa-app-mode'
import { createPwaPageServices } from '@/lib/services/pwa-wiring'
import { bootstrapPageRuntime } from '@/lib/services/runtime'
import { router } from '@/router'

// One page runtime before React renders. The PWA service bundle owns browser
// listeners, update checks/coordination, notification navigation, and install
// capture from here (single owners — no legacy singletons beside them); the
// runtime owns their disposal (StrictMode/HMR safe, no duplicate runs).
const pwaServices = createPwaPageServices({
  navigate: (url) => {
    void router.navigate({ to: url })
  },
})
bootstrapPageRuntime({
  initAppMode: initPwaAppMode,
  startPwaServices: () => {
    pwaServices.start()
    return () => {
      pwaServices.stop()
    }
  },
})
await initI18n()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

// Keep the branded shell over the first React commit so concurrent rendering
// cannot expose a blank frame between bootstrap removal and app paint.
requestAnimationFrame(() => {
  document.getElementById('pwa-bootstrap')?.remove()
})
