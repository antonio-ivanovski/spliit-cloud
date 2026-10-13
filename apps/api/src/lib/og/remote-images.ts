const FETCH_TIMEOUT_MS = 1500
const MAX_IMAGE_BYTES = 512 * 1024

const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
])

const twemojiCache = new Map<string, string | null>()
const MAX_TWEMOJI_CACHE = 200

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Fetch a remote raster image and inline it as a data URI for Satori/resvg.
 * Null on any failure (timeout, non-image, oversize) so callers fall back to
 * initials — avatar fetching must never fail a card render.
 */
export async function fetchImageAsDataUri(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!isHttpUrl(url)) return null
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    })
    if (!response.ok) return null
    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase()
    if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) return null
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
      return null
    }
    return `data:${contentType};base64,${Buffer.from(buffer).toString('base64')}`
  } catch {
    return null
  }
}

/** First grapheme cluster of a string (so ZWJ sequences and flags stay whole). */
export function firstGrapheme(value: string): string {
  try {
    const segments = new Intl.Segmenter('en', { granularity: 'grapheme' })
    for (const segment of segments.segment(value)) return segment.segment
  } catch {
    // Intl.Segmenter is unavailable in some runtimes; fall back below.
  }
  return Array.from(value)[0] ?? ''
}

function graphemeToTwemojiCode(grapheme: string): string | null {
  // Twemoji asset names drop the FE0F variation selector (e.g. 🏖️ is 1f3d6).
  const parts: string[] = []
  for (const char of grapheme) {
    const point = char.codePointAt(0)
    if (point === undefined || point === 0xfe0f) continue
    parts.push(point.toString(16))
  }
  return parts.length > 0 ? parts.join('-') : null
}

/**
 * Resolve a group emoji to an embedded Twemoji PNG data URI. Color-emoji fonts
 * are not available in the production image, so the emoji is painted as a
 * raster instead of shaped text. Successful lookups are cached in memory;
 * misses are never cached so a transient CDN failure retries on the next render
 * instead of degrading to the letter tile until restart. Misses fall back to a
 * letter tile.
 */
export async function fetchEmojiImage(
  emoji: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ grapheme: string; dataUri: string | null }> {
  const grapheme = emoji ? firstGrapheme(emoji.trim()) : ''
  if (!grapheme) return { grapheme: '', dataUri: null }
  const cached = twemojiCache.get(grapheme)
  if (cached !== undefined) return { grapheme, dataUri: cached }
  let dataUri: string | null = null
  const code = graphemeToTwemojiCode(grapheme)
  if (code) {
    dataUri = await fetchImageAsDataUri(
      `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${code}.png`,
      fetchImpl,
    )
  }
  if (twemojiCache.size >= MAX_TWEMOJI_CACHE) twemojiCache.clear()
  if (dataUri !== null) twemojiCache.set(grapheme, dataUri)
  return { grapheme, dataUri }
}

/** Test-only reset for the Twemoji cache. */
export function resetEmojiCacheForTests(): void {
  twemojiCache.clear()
}
