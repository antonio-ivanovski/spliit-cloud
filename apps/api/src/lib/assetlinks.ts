import { env } from './env'

export const ASSET_LINKS_RELATION = 'delegate_permission/common.handle_all_urls'
export const ASSET_LINKS_NAMESPACE = 'android_app'

export type AssetLinksSource = {
  TWA_PACKAGE_NAME?: string
  TWA_SHA256_FINGERPRINTS?: string
}

/**
 * Normalize one SHA-256 certificate fingerprint to the Digital Asset Links wire
 * format: uppercase hex without colons (64 chars). Accepts the colon-separated
 * `keytool`/`apksigner` output form as well. Returns undefined for anything
 * that is not a plausible SHA-256 fingerprint so a typo can never silently ship
 * in `assetlinks.json`.
 */
export function normalizeFingerprint(value: string): string | undefined {
  const compact = value.replace(/:/g, '').toUpperCase()
  return /^[0-9A-F]{64}$/.test(compact) ? compact : undefined
}

export function parseFingerprints(value: string | undefined): string[] {
  if (!value) return []
  const seen = new Set<string>()
  for (const part of value.split(',')) {
    const normalized = normalizeFingerprint(part.trim())
    if (normalized) seen.add(normalized)
  }
  return [...seen]
}

export type AssetLinksStatement = {
  relation: string[]
  target: {
    namespace: string
    package_name: string
    sha256_cert_fingerprints: string[]
  }
}

/**
 * Build the `/.well-known/assetlinks.json` statements for the configured TWA.
 * Returns undefined when the instance has no TWA configured so the route can
 * 404 honestly instead of serving an empty claim list. Accepts an explicit
 * source so tests can pass isolated env objects.
 */
export function getAssetLinksStatements(
  source: AssetLinksSource = env,
): AssetLinksStatement[] | undefined {
  const packageName = source.TWA_PACKAGE_NAME?.trim()
  const fingerprints = parseFingerprints(source.TWA_SHA256_FINGERPRINTS)
  if (!packageName || fingerprints.length === 0) return undefined
  return [
    {
      relation: [ASSET_LINKS_RELATION],
      target: {
        namespace: ASSET_LINKS_NAMESPACE,
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]
}
