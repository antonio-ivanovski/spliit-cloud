/**
 * Replace the current document so authentication state is re-read from the
 * server instead of relying on SPA caches after a session changes.
 */
export function replaceBrowserLocation(path: string) {
  window.location.replace(path)
}
