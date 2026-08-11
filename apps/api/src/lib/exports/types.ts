import type { SpliitExportDocument } from '@spliit/domain/export-manifest'

export type ExportDocumentRecord = {
  id: string
  url: string
  fileName: string | null
  contentType: string | null
  width: number | null
  height: number | null
}

export interface ExportDocumentReader {
  read(document: ExportDocumentRecord, signal: AbortSignal): Promise<Uint8Array>
}

export type ExportBundleDocument = {
  record: ExportDocumentRecord
  entry: SpliitExportDocument
  markMissing(intendedPath: string): void
}

export type ExportSnapshotDocument = Omit<ExportBundleDocument, 'markMissing'>

export type ExportArchiveEntry = {
  path: string
  bytes: Uint8Array
}

export type ExportScope = {
  type: 'GROUP' | 'ACCOUNT'
  sourceId: string
}

export type ExportArtifact = {
  fileName: string
  mediaType: 'application/zip'
  scope: ExportScope
  exportedAt: string
  body: ReadableStream<Uint8Array>
}
