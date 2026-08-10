import { spliitGroupExportManifestSchema } from '@spliit/domain/export-manifest'

import { createExportBundleStream } from './archive'
import {
  createGroupExportSnapshot,
  type GroupExportSource,
} from './group-snapshot'
import type {
  ExportArchiveEntry,
  ExportArtifact,
  ExportDocumentReader,
} from './types'

export function createGroupExportArtifact(
  group: GroupExportSource,
  options: {
    exportedAt: Date
    documentReader: ExportDocumentReader
    additionalEntries?: ReadonlyArray<ExportArchiveEntry>
    signal?: AbortSignal
  },
): ExportArtifact {
  const exportedAt = options.exportedAt.toISOString()
  const { snapshot, documents } = createGroupExportSnapshot(group)
  const manifest = {
    format: 'spliit.cloud/export' as const,
    version: 1 as const,
    scope: { type: 'GROUP' as const, sourceId: group.id },
    exportedAt,
    ...snapshot,
  }

  const bundleDocuments = documents.map((document) => ({
    ...document,
    markMissing(intendedPath: string) {
      manifest.complete = false
      manifest.warnings.push({
        type: 'MISSING_DOCUMENT',
        documentId: document.entry.sourceId,
        path: intendedPath,
      })
    },
  }))

  const date = exportedAt.slice(0, 10)
  return {
    fileName: `Spliit Cloud Export - ${group.name} - ${date}.spliit.zip`,
    mediaType: 'application/zip',
    scope: manifest.scope,
    exportedAt,
    body: createExportBundleStream({
      manifest,
      documents: bundleDocuments,
      documentReader: options.documentReader,
      validateManifest: (value) => spliitGroupExportManifestSchema.parse(value),
      additionalEntries: options.additionalEntries,
      signal: options.signal,
    }),
  }
}
