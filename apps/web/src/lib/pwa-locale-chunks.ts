/**
 * Locale-chunk precache policy.
 *
 * Every `messages/<locale>.json` bundle compiles to `assets/<locale>-<hash>.js`
 * chunks (~7.5 MB for all 32 locales, while one device needs its locale plus
 * its fallback chain). Only the default bundle and its tiny overlay stay in the
 * precache; the rest load on demand and persist through the service worker's
 * runtime cache (`sw.ts`) with an i18next fallback to en-US when a chunk is
 * unreachable offline (`i18n/setup.ts`).
 */

/** Bundles kept in the precache: default + tiny opt-in overlay. */
export const PRECACHED_LOCALES = ['en-US', 'en-GB'] as const

/** Versioned runtime cache for on-demand locale chunks (bump to reset). */
export const LOCALE_CHUNK_CACHE_NAME = 'spliit-locale-chunks-v1'

/** Bound on entries so stale per-deploy hashes cannot grow without limit. */
export const MAX_LOCALE_CHUNK_ENTRIES = 48

/**
 * Workbox `globIgnores` entries for every locale chunk outside the keep list.
 * Matched against dist-relative paths, e.g. `assets/bn-BD-Bsijys88.js`.
 * Verified collision-free: no non-locale chunk starts with `<locale>-`.
 */
export function buildLocaleChunkIgnores(
  allLocales: readonly string[],
  keep: readonly string[] = PRECACHED_LOCALES,
): string[] {
  const keepSet = new Set(keep)
  return allLocales
    .filter((locale) => !keepSet.has(locale))
    .map((locale) => `assets/${locale}-*.js`)
}

/** True for `/assets/<locale>-<hash>.js` paths of any known locale. */
export function isLocaleChunkPath(
  pathname: string,
  allLocales: readonly string[],
): boolean {
  const match = /^\/assets\/(.+)-[A-Za-z0-9_.-]+\.js$/.exec(pathname)
  if (!match?.[1]) return false
  const possibleTag = match[1]
  // Chunk names are `<locale>-<hash>`; the hash itself may contain dashes
  // (`en-GB-DWiwjUG-.js`), so accept the longest known-locale prefix.
  return allLocales.some(
    (locale) => possibleTag === locale || possibleTag.startsWith(`${locale}-`),
  )
}
