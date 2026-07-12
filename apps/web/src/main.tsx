import '@/app/globals.css'
import { initI18n } from '@/i18n/react'
import { installAppRecovery } from '@/lib/app-recovery'
import '@/pwa-registration'
import { router } from '@/router'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

await initI18n()

installAppRecovery()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

// The inline bootstrap guard in index.html handles entry-module and early
// startup failures. Only stand it down after i18n, recovery installation, and
// the initial React render have all started successfully.
if (typeof window !== 'undefined') {
  const bootstrapWindow = window as unknown as {
    __spliitAppBooted?: boolean
  }
  bootstrapWindow.__spliitAppBooted = true
}
