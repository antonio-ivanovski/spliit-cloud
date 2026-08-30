import '@/app/globals.css'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { initI18n } from '@/i18n/setup'
import { startPwaUpdateManager } from '@/lib/pwa-update-manager'
import { router } from '@/router'

const pwaUpdateManager = startPwaUpdateManager()

const bootstrapStatus = document.getElementById('pwa-bootstrap-status')
const bootstrapProgress = document.getElementById('pwa-bootstrap-progress')
const bootstrapStageText = {
  checking: '',
  downloading: 'Downloading update…',
  'checking-clients': 'Checking open Spliit windows…',
  applying: 'Applying update…',
  restarting: 'Restarting Spliit…',
} as const
const updateBootstrapStatus = () => {
  const stage = pwaUpdateManager.getStage()
  const checking = stage === 'checking'
  if (bootstrapStatus) {
    bootstrapStatus.textContent = bootstrapStageText[stage]
    bootstrapStatus.hidden = checking
  }
  if (bootstrapProgress) bootstrapProgress.hidden = checking
}
const unsubscribeBootstrap = pwaUpdateManager.subscribe(updateBootstrapStatus)
updateBootstrapStatus()

await Promise.all([initI18n(), pwaUpdateManager.waitForLaunch()])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

// Keep the branded shell over the first React commit so concurrent rendering
// cannot expose a blank frame between bootstrap removal and app paint.
requestAnimationFrame(() => {
  unsubscribeBootstrap()
  document.getElementById('pwa-bootstrap')?.remove()
})
