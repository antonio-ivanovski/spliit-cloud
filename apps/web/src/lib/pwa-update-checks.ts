const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

type UpdateRegistration = {
  update: () => Promise<unknown>
}

type UpdateCheckDocument = Pick<
  Document,
  'addEventListener' | 'removeEventListener' | 'visibilityState'
>

type UpdateCheckWindow = Pick<
  Window,
  'addEventListener' | 'removeEventListener' | 'setInterval' | 'clearInterval'
>

/**
 * Recheck for a waiting service worker while an installed PWA stays open.
 * Browsers only poll `sw.js` on navigation by default.
 */
export function subscribeServiceWorkerUpdateChecks(
  registration: UpdateRegistration,
  options: {
    intervalMs?: number
    document?: UpdateCheckDocument
    window?: UpdateCheckWindow
  } = {},
): () => void {
  const doc = options.document ?? document
  const win = options.window ?? window
  const intervalMs = options.intervalMs ?? DEFAULT_UPDATE_CHECK_INTERVAL_MS

  const check = () => {
    void registration.update()
  }

  const onVisibilityChange = () => {
    if (doc.visibilityState === 'visible') check()
  }

  doc.addEventListener('visibilitychange', onVisibilityChange)
  win.addEventListener('online', check)
  const intervalId = win.setInterval(check, intervalMs)

  return () => {
    doc.removeEventListener('visibilitychange', onVisibilityChange)
    win.removeEventListener('online', check)
    win.clearInterval(intervalId)
  }
}
