import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type OgFont = {
  name: string
  data: ArrayBuffer
  weight: 400 | 700
  style: 'normal'
}

let cachedFonts: Promise<OgFont[]> | null = null

function candidateDirs(): string[] {
  const dirs: string[] = []
  const override = process.env.OG_FONTS_DIR?.trim()
  if (override) dirs.push(override)
  try {
    // Production bundle: dist/server.js with fonts copied to ../fonts.
    // Dev: src/server.ts with fonts at src/lib/og/fonts.
    const here = dirname(fileURLToPath(import.meta.url))
    // Dev: src/lib/og/fonts.ts -> src/lib/og/fonts.
    // Production bundle: dist/server.js -> ../fonts (copied beside dist).
    dirs.push(resolve(here, 'fonts'))
    dirs.push(resolve(here, '..', 'fonts'))
  } catch {
    // import.meta.url is unavailable in some test setups; fall through.
  }
  // Last resort: repository-relative path when running from the package dir.
  dirs.push(resolve(process.cwd(), 'src', 'lib', 'og', 'fonts'))
  return dirs
}

/**
 * Load the Inter woff2 pair Satori needs for layout. Resolved from disk (never
 * bundled) so the Docker image just copies the fonts directory next to the
 * bundle. The promise is shared across renders.
 */
export function loadOgFonts(): Promise<OgFont[]> {
  if (!cachedFonts) {
    cachedFonts = (async () => {
      const files = [
        { file: 'Inter-Regular.woff2', weight: 400 as const },
        { file: 'Inter-Bold.woff2', weight: 700 as const },
      ]
      for (const dir of candidateDirs()) {
        try {
          const pair = await Promise.all(
            files.map(async ({ file, weight }) => {
              const data = await readFile(resolve(dir, file))
              return {
                name: 'Inter',
                data: data.buffer.slice(
                  data.byteOffset,
                  data.byteOffset + data.byteLength,
                ) as ArrayBuffer,
                weight,
                style: 'normal' as const,
              }
            }),
          )
          return pair
        } catch {
          // Try the next candidate directory.
        }
      }
      throw new Error(
        'OG fonts not found. Set OG_FONTS_DIR or copy src/lib/og/fonts next to the bundle.',
      )
    })()
  }
  return cachedFonts
}

/** Test-only reset for the cached font promise. */
export function resetOgFontsForTests(): void {
  cachedFonts = null
}
