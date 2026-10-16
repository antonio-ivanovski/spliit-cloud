import { Effect, Exit, Predicate, Schema } from 'effect'

import {
  spliitAccountExportManifestSchema,
  spliitGroupExportManifestSchema,
  type SpliitAccountExportManifest,
  type SpliitGroupExportManifest,
} from '../export-manifest'
import { spliitExportSchema } from './spliit'
import { parseSpliitCsv } from './spliit-csv'
import { ImportError } from './types'

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
  const decoded = Effect.runSyncExit(
    Schema.decodeUnknownEffect(spliitExportSchema)(input),
  )
  if (Exit.isSuccess(decoded)) {
    return { kind: 'SPLIIT_APP_JSON' }
  }

  if (
    Predicate.isObject(input) &&
    !Array.isArray(input) &&
    (input as { format?: unknown }).format === 'spliit.cloud/export'
  ) {
    const candidate = input as {
      format?: unknown
      scope?: { type?: unknown }
    }
    return {
      kind: 'SPLIIT_CLOUD_MANIFEST',
      scope:
        typeof candidate.scope?.type === 'string'
          ? candidate.scope.type
          : undefined,
    }
  }

  return { kind: 'UNKNOWN' }
}

/**
 * Classify text before selecting a provider-specific parser. The legacy spliit
 * CSV shape is part of the same `spliit` registry entry, so it resolves
 * directly — no callback needed (`spliit-csv` never imports this module, so
 * there is no cycle).
 */
export function classifyImportText(
  fileName: string,
  text: string,
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
  if (Exit.isSuccess(Effect.runSyncExit(parseSpliitCsv(text)))) {
    return { kind: 'SPLIIT_APP_CSV' }
  }
  return { kind: 'UNKNOWN' }
}

export const parseCloudGroupManifest = Effect.fnUntraced(function* (
  input: unknown,
): Effect.fn.Return<SpliitGroupExportManifest, ImportError> {
  const parsed = yield* Effect.try({
    try: () => spliitGroupExportManifestSchema.parse(input),
    catch: (cause) =>
      new ImportError({
        message:
          cause instanceof Error ? cause.message : 'Invalid Cloud manifest',
      }),
  })
  return parsed
})

export const parseCloudAccountManifest = Effect.fnUntraced(function* (
  input: unknown,
): Effect.fn.Return<SpliitAccountExportManifest, ImportError> {
  const parsed = yield* Effect.try({
    try: () => spliitAccountExportManifestSchema.parse(input),
    catch: (cause) =>
      new ImportError({
        message:
          cause instanceof Error ? cause.message : 'Invalid Cloud manifest',
      }),
  })
  return parsed
})
