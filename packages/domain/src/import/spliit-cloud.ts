import {
  spliitGroupExportManifestSchema,
  type SpliitGroupExportManifest,
} from '../export-manifest'
import { spliitExportSchema } from './spliit'

export type ImportFileKind =
  | 'SPLIIT_CLOUD_BUNDLE'
  | 'SPLIIT_CLOUD_MANIFEST'
  | 'SPLIIT_APP_JSON'
  | 'SPLIIT_APP_CSV'
  | 'UNKNOWN'

export type ImportFileClassification = {
  kind: ImportFileKind
  /** Set when a Cloud manifest was found but is not a group bundle. */
  scope?: string
}

const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
] as const

export function hasZipSignature(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURES.some((signature) =>
    signature.every((value, index) => bytes[index] === value),
  )
}

export function classifyImportBytes(
  bytes: Uint8Array,
): ImportFileClassification {
  return hasZipSignature(bytes)
    ? { kind: 'SPLIIT_CLOUD_BUNDLE' }
    : { kind: 'UNKNOWN' }
}

export function classifyImportPayload(
  input: unknown,
): ImportFileClassification {
  if (spliitExportSchema.safeParse(input).success) {
    return { kind: 'SPLIIT_APP_JSON' }
  }

  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const candidate = input as {
      format?: unknown
      scope?: { type?: unknown }
    }
    if (candidate.format === 'spliit.cloud/export') {
      return {
        kind: 'SPLIIT_CLOUD_MANIFEST',
        scope:
          typeof candidate.scope?.type === 'string'
            ? candidate.scope.type
            : undefined,
      }
    }
  }

  return { kind: 'UNKNOWN' }
}

/**
 * Classify text before selecting a provider-specific parser. The Spliit CSV
 * parser is intentionally not imported here so this helper remains usable by
 * the web source classifier without creating a parser cycle.
 */
export function classifyImportText(
  fileName: string,
  text: string,
  parseSpliitCsv: (value: string) => { ok: boolean },
): ImportFileClassification {
  const lower = fileName.toLowerCase()
  // Inspect the content as well as the extension. Files downloaded through
  // desktop mail clients and cloud drives frequently lose or replace their
  // original extension/MIME type, but the JSON/CSV payload is still enough to
  // route it to the right importer.
  if (lower.endsWith('.json') || text.trimStart().startsWith('{')) {
    try {
      return classifyImportPayload(JSON.parse(text))
    } catch {
      // A malformed JSON file should continue through the normal parser error
      // path rather than being mistaken for a different application export.
    }
  }
  if (parseSpliitCsv(text).ok) {
    return { kind: 'SPLIIT_APP_CSV' }
  }
  return { kind: 'UNKNOWN' }
}

export function parseCloudGroupManifest(
  input: unknown,
): SpliitGroupExportManifest {
  return spliitGroupExportManifestSchema.parse(input)
}
