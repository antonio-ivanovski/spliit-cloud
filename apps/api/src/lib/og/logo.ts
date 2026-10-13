import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Brand lockup dimensions in the card footer. The asset is pre-sized to exactly
 * these pixels: resvg renders `<image>` content at its natural size and clips
 * to the viewport instead of downscaling, so the file must never be larger than
 * this box.
 */
export const OG_LOGO_WIDTH = 159
export const OG_LOGO_HEIGHT = 48

const LOGO_FILE = 'logo-with-text.png'

let cachedLogo: Promise<string | null> | null = null

function candidateDirs(): string[] {
  const dirs: string[] = []
  const override = process.env.OG_ASSETS_DIR?.trim()
  if (override) dirs.push(override)
  try {
    // Production bundle: dist/server.js with assets copied beside dist.
    // Dev: src/server.ts with assets at src/lib/og/assets.
    const here = dirname(fileURLToPath(import.meta.url))
    // Dev: src/lib/og/logo.ts -> src/lib/og/assets.
    // Production bundle: dist/server.js -> ../assets (copied beside dist).
    dirs.push(resolve(here, 'assets'))
    dirs.push(resolve(here, '..', 'assets'))
  } catch {
    // import.meta.url is unavailable in some test setups; fall through.
  }
  // Last resort: repository-relative path when running from the package dir.
  dirs.push(resolve(process.cwd(), 'src', 'lib', 'og', 'assets'))
  return dirs
}

/**
 * Load the Spliit brand lockup for the card footer as a PNG data URI (same
 * pattern as fonts.ts: resolved from disk, never bundled). Raster PNG — not the
 * SVG source — so resvg rasterizes a proven path instead of SVG-in-SVG. Cached
 * across renders; null when the asset is missing so callers fall back to the
 * CSS tile instead of failing the render.
 */
export function loadOgLogo(): Promise<string | null> {
  if (!cachedLogo) {
    cachedLogo = (async () => {
      for (const dir of candidateDirs()) {
        try {
          const data = await readFile(resolve(dir, LOGO_FILE))
          return `data:image/png;base64,${data.toString('base64')}`
        } catch {
          // Try the next candidate directory.
        }
      }
      return null
    })()
  }
  return cachedLogo
}

/** Test-only reset for the cached logo promise. */
export function resetOgLogoForTests(): void {
  cachedLogo = null
}
