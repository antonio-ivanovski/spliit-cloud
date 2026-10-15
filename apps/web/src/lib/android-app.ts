const SESSION_KEY = 'spliit-android-app'

/** Presentation hint only; this must never authorize data access or purchases. */
export function isAndroidApp(): boolean {
  if (typeof window === 'undefined') return false
  const fromLaunch =
    new URLSearchParams(window.location.search)
      .getAll('android-app')
      .includes('1') ||
    document.referrer.startsWith('android-app://cloud.spliit.twa')
  try {
    if (fromLaunch) window.sessionStorage.setItem(SESSION_KEY, '1')
    return fromLaunch || window.sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return fromLaunch
  }
}
