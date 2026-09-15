import '@/app/globals.css'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { initI18n } from '@/i18n/setup'
import { startPwaUpdateManager } from '@/lib/pwa-update-manager'
import { router } from '@/router'

startPwaUpdateManager()
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
