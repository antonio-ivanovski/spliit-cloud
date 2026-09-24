/**
 * Tags the document with how it was launched so CSS can tune the installed PWA
 * shell (overscroll, tap highlight) without touching browser tabs.
 *
 * Detection mirrors `use-install-prompt.ts`: any installed display mode, iOS
 * `navigator.standalone`, or an Android TWA referrer counts as PWA.
 */

const INSTALLED_DISPLAY_MODES = [
  'fullscreen',
  'standalone',
  'minimal-ui',
  'window-controls-overlay',
  'picture-in-picture',
] as const

export function isLaunchedAsApp(): boolean {
  if (typeof window === 'undefined') return false
  const launchedAsApp =
    typeof window.matchMedia === 'function' &&
    INSTALLED_DISPLAY_MODES.some(
      (mode) => window.matchMedia(`(display-mode: ${mode})`).matches,
    )
  const iosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  const twaReferrer =
    typeof document !== 'undefined' &&
    typeof document.referrer === 'string' &&
    document.referrer.startsWith('android-app://')
  return launchedAsApp || iosStandalone || twaReferrer
}

function applyAppMode() {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.appMode = isLaunchedAsApp()
    ? 'pwa'
    : 'browser'
}

/** Set `data-app-mode` once and keep it fresh across display-mode changes. */
export function initPwaAppMode(): () => void {
  applyAppMode()
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return () => {}
  }
  const queries = INSTALLED_DISPLAY_MODES.map((mode) =>
    window.matchMedia(`(display-mode: ${mode})`),
  )
  const onChange = () => applyAppMode()
  for (const query of queries) {
    // `addEventListener` is standard; fall back for old iOS Safari.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange)
    } else {
      query.addListener(onChange)
    }
  }
  document.addEventListener('visibilitychange', onChange)
  return () => {
    for (const query of queries) {
      if (typeof query.removeEventListener === 'function') {
        query.removeEventListener('change', onChange)
      } else {
        query.removeListener(onChange)
      }
    }
    document.removeEventListener('visibilitychange', onChange)
  }
}
