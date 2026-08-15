/**
 * NavigationRoute denylist for the app-shell worker.
 *
 * Workbox tests these against `pathname + search`. A match means "do not serve
 * cached index.html" — the request falls through to the network (API, OAuth
 * callbacks, the worker script itself).
 *
 * SPA auth pages must stay off this list so `/auth/forgot-password` still
 * launches offline. Better Auth's other `/auth/*` document navigations must
 * stay on it or OAuth redirects would get the SPA shell.
 */
export const APP_SHELL_NAVIGATION_DENYLIST: readonly RegExp[] = [
  /^\/sw\.js(?:$|\?)/,
  /^\/registerSW\.js(?:$|\?)/,
  /^\/manifest\.webmanifest(?:$|\?)/,
  /^\/trpc(?:\/|$|\?)/,
  /^\/health(?:\/|$|\?)/,
  /^\/email\/unsubscribe(?:$|\?)/,
  /^\/openapi\.json(?:$|\?)/,
  /^\/docs(?:$|\?)/,
  /^\/\.well-known(?:\/|$)/,
  /\/expenses\/export\/(?:json|csv)(?:$|\?)/,
  /^\/auth$/,
  /^\/auth\/(?!forgot-password(?:$|\?)|reset-password(?:$|\?)|complete-profile(?:$|\?)|recover(?:$|\?))/,
]

export function shouldUseAppShellNavigation(
  pathnameAndSearch: string,
): boolean {
  return !APP_SHELL_NAVIGATION_DENYLIST.some((pattern) =>
    pattern.test(pathnameAndSearch),
  )
}
