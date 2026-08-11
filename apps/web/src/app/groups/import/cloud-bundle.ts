import { AsyncUnzipInflate, Unzip, UnzipPassThrough } from 'fflate'

import type { SpliitGroupExportManifest } from '@spliit/domain'
import { hasZipSignature, parseCloudGroupManifest } from '@spliit/domain/import'

export const MAX_CLOUD_BUNDLE_BYTES = 256 * 1024 * 1024
export const MAX_CLOUD_BUNDLE_EXPANDED_BYTES = 512 * 1024 * 1024
export const MAX_CLOUD_BUNDLE_ENTRIES = 10_000
export const MAX_CLOUD_BUNDLE_MANIFEST_BYTES = 16 * 1024 * 1024
export const MAX_CLOUD_DOCUMENT_BYTES = 2 * 1024 * 1024

export class CloudAccountBundleError extends Error {
  readonly scope = 'ACCOUNT' as const

  constructor() {
    super('Account-wide Spliit Cloud bundle import is not available yet.')
    this.name = 'CloudAccountBundleError'
  }
}

export type CloudBundleDocumentIssue = {
  sourceId: string
  path: string | null
  message: string
}

export type CloudGroupBundleInspection = {
  kind: 'GROUP'
  manifest: SpliitGroupExportManifest
  /** Validated document bytes keyed by the manifest document source ID. */
  documents: Map<string, Uint8Array>
  documentIssues: CloudBundleDocumentIssue[]
}

function isSafeArchivePath(path: string): boolean {
  const segments = path.split('/')
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    segments.every(
      (segment) => segment.length > 0 && segment !== '.' && segment !== '..',
    )
  )
}

function concatChunks(chunks: Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer>,
  )
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function manifestDocuments(manifest: SpliitGroupExportManifest) {
  return [
    ...manifest.expenses.flatMap((expense) => expense.documents),
    ...manifest.orphanDocuments,
  ]
}

function ensureUniqueShareRows(
  rows: ReadonlyArray<{
    participantId?: string
    ledgerParticipantId?: string
  }>,
  label: string,
) {
  const ids = rows.map((row) => row.participantId ?? row.ledgerParticipantId)
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Cloud manifest contains duplicate ${label} rows.`)
  }
}

function validateManifestReferences(manifest: SpliitGroupExportManifest) {
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) {
      throw new Error(`Cloud manifest contains duplicate ${label} IDs.`)
    }
  }
  if (manifest.scope.sourceId !== manifest.group.sourceId) {
    throw new Error('Cloud manifest scope does not match its group.')
  }
  unique(
    manifest.participants.map((participant) => participant.sourceId),
    'participant',
  )
  unique(
    manifest.subgroups.map((subgroup) => subgroup.sourceId),
    'subgroup',
  )
  unique(
    manifest.budgets.map((budget) => budget.sourceId),
    'budget',
  )
  unique(
    manifest.recurrenceSeries.map((series) => series.sourceId),
    'recurrence series',
  )
  unique(
    manifest.expenses.map((expense) => expense.sourceId),
    'expense',
  )
  const itemIds = manifest.expenses.flatMap((expense) =>
    expense.items.map((item) => item.sourceId),
  )
  unique(itemIds, 'expense item')
  const documents = manifestDocuments(manifest)
  unique(
    documents.map((document) => document.sourceId),
    'document',
  )
  const documentIds = new Set(documents.map((document) => document.sourceId))
  for (const warning of manifest.warnings) {
    if (!documentIds.has(warning.documentId)) {
      throw new Error('Cloud manifest warning references an unknown document.')
    }
    if (warning.path !== null && !isSafeArchivePath(warning.path)) {
      throw new Error('Cloud manifest warning path is unsafe.')
    }
  }
  const participantIds = new Set(
    manifest.participants.map((participant) => participant.sourceId),
  )
  const ensureParticipant = (id: string) => {
    if (!participantIds.has(id)) {
      throw new Error('Cloud manifest references an unknown participant.')
    }
  }
  const seriesIds = new Set(
    manifest.recurrenceSeries.map((series) => series.sourceId),
  )
  const commentIds = new Set<string>()
  for (const subgroup of manifest.subgroups) {
    subgroup.participantIds.forEach(ensureParticipant)
  }
  const subgroupParticipants = new Set<string>()
  for (const subgroup of manifest.subgroups) {
    for (const id of subgroup.participantIds) {
      if (subgroupParticipants.has(id)) {
        throw new Error('Cloud participant belongs to multiple subgroups.')
      }
      subgroupParticipants.add(id)
    }
  }
  for (const budget of manifest.budgets) {
    budget.participantIds.forEach(ensureParticipant)
  }
  for (const series of manifest.recurrenceSeries) {
    if (series.creatorParticipantId)
      ensureParticipant(series.creatorParticipantId)
    const template = series.template
    ensureUniqueShareRows(template.paidByList, 'recurrence payer')
    ensureUniqueShareRows(template.paidFor, 'recurrence share')
    for (const row of [...template.paidByList, ...template.paidFor]) {
      ensureParticipant(row.ledgerParticipantId)
    }
    for (const item of template.items) {
      ensureUniqueShareRows(item.paidFor, 'recurrence item share')
      item.paidFor.forEach((row) => ensureParticipant(row.ledgerParticipantId))
    }
    ensureUniqueShareRows(
      template.itemizedRemainder?.paidFor ?? [],
      'recurrence remainder share',
    )
    template.itemizedRemainder?.paidFor.forEach((row) =>
      ensureParticipant(row.ledgerParticipantId),
    )
  }
  for (const expense of manifest.expenses) {
    if (expense.createdByParticipantId)
      ensureParticipant(expense.createdByParticipantId)
    if (
      expense.recurringSeriesId &&
      !seriesIds.has(expense.recurringSeriesId)
    ) {
      throw new Error('Cloud manifest references an unknown recurrence series.')
    }
    ensureUniqueShareRows(expense.paidByList, 'expense payer')
    ensureUniqueShareRows(expense.paidFor, 'expense share')
    for (const row of [...expense.paidByList, ...expense.paidFor]) {
      ensureParticipant(row.participantId)
    }
    for (const item of expense.items) {
      ensureUniqueShareRows(item.paidFor, 'expense item share')
      item.paidFor.forEach((row) => ensureParticipant(row.participantId))
    }
    ensureUniqueShareRows(
      expense.itemizedRemainder?.paidFor ?? [],
      'expense remainder share',
    )
    expense.itemizedRemainder?.paidFor.forEach((row) =>
      ensureParticipant(row.participantId),
    )
    expense.comments.forEach((comment) => {
      if (commentIds.has(comment.sourceId)) {
        throw new Error('Cloud manifest contains duplicate comment IDs.')
      }
      commentIds.add(comment.sourceId)
      if (comment.authorParticipantId)
        ensureParticipant(comment.authorParticipantId)
    })
  }
}

/**
 * Inspect a Cloud bundle in the browser without synchronously inflating the
 * archive. Only manifest.json and documents referenced by the manifest are
 * retained; viewer assets and other future entries are safely ignored.
 */
export async function inspectSpliitCloudBundle(
  input: Blob,
): Promise<CloudGroupBundleInspection> {
  if (input.size > MAX_CLOUD_BUNDLE_BYTES) {
    throw new Error('This Spliit Cloud bundle is too large to import.')
  }

  const firstChunk = new Uint8Array(await input.slice(0, 4).arrayBuffer())
  if (!hasZipSignature(firstChunk)) {
    throw new Error('This file is not a Spliit Cloud ZIP bundle.')
  }

  const extracted = new Map<string, Uint8Array>()
  const seenEntries = new Set<string>()
  const pending: Promise<void>[] = []
  let entryCount = 0
  let expandedBytes = 0
  let manifestBytes: Uint8Array | null = null
  let failure: Error | null = null

  const unzip = new Unzip((entry) => {
    entryCount += 1
    if (entryCount > MAX_CLOUD_BUNDLE_ENTRIES) {
      failure ??= new Error('This Spliit Cloud bundle contains too many files.')
      return
    }

    const isManifest = entry.name === 'manifest.json'
    const isDocument = entry.name.startsWith('documents/')
    if (!isManifest && !isDocument) return

    // ZIP writers may include directory records. They carry no restore data
    // and should not make an otherwise valid archive fail path validation.
    if (entry.name.endsWith('/')) return

    if (!isSafeArchivePath(entry.name)) {
      failure ??= new Error(`Unsafe archive path: ${entry.name}`)
      return
    }
    if (seenEntries.has(entry.name)) {
      failure ??= new Error(`Duplicate archive entry: ${entry.name}`)
      return
    }
    seenEntries.add(entry.name)

    if (entry.originalSize !== undefined) {
      const max = isManifest
        ? MAX_CLOUD_BUNDLE_MANIFEST_BYTES
        : MAX_CLOUD_DOCUMENT_BYTES
      if (entry.originalSize > max) {
        failure ??= new Error(
          `Archive entry exceeds its size limit: ${entry.name}`,
        )
        return
      }
      expandedBytes += entry.originalSize
      if (expandedBytes > MAX_CLOUD_BUNDLE_EXPANDED_BYTES) {
        failure ??= new Error(
          'Expanded Cloud bundle data exceeds the import limit.',
        )
        return
      }
    }

    const chunks: Uint8Array[] = []
    let size = 0
    let expandedSizeAccounted = entry.originalSize !== undefined
    pending.push(
      new Promise<void>((resolve, reject) => {
        entry.ondata = (error, chunk, final) => {
          if (error) {
            reject(error)
            return
          }
          if (chunk.byteLength > 0) {
            size += chunk.byteLength
            if (
              size >
              (isManifest
                ? MAX_CLOUD_BUNDLE_MANIFEST_BYTES
                : MAX_CLOUD_DOCUMENT_BYTES)
            ) {
              reject(
                new Error(
                  `Archive entry exceeds its size limit: ${entry.name}`,
                ),
              )
              return
            }
            chunks.push(chunk)
          }
          if (!final) return
          if (!expandedSizeAccounted) {
            expandedBytes += size
            expandedSizeAccounted = true
            if (expandedBytes > MAX_CLOUD_BUNDLE_EXPANDED_BYTES) {
              reject(
                new Error(
                  'Expanded Cloud bundle data exceeds the import limit.',
                ),
              )
              return
            }
          }
          const bytes = concatChunks(chunks, size)
          if (isManifest) manifestBytes = bytes
          else extracted.set(entry.name, bytes)
          resolve()
        }
        try {
          entry.start()
        } catch (error) {
          reject(error)
        }
      }),
    )
  })
  unzip.register(AsyncUnzipInflate)
  unzip.register(UnzipPassThrough)

  const reader = input.stream().getReader()
  try {
    while (true) {
      const next = await reader.read()
      unzip.push(next.value ?? new Uint8Array(), next.done)
      if (next.done) break
    }
  } catch (error) {
    failure ??=
      error instanceof Error ? error : new Error('Invalid ZIP bundle.')
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  const settled = await Promise.allSettled(pending)
  const rejected = settled.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (rejected) {
    failure ??=
      rejected.reason instanceof Error
        ? rejected.reason
        : new Error('Invalid ZIP bundle.')
  }
  if (failure) throw failure
  if (!manifestBytes) throw new Error('Cloud bundle is missing manifest.json.')

  let rawManifest: unknown
  try {
    rawManifest = JSON.parse(new TextDecoder().decode(manifestBytes))
  } catch {
    throw new Error('Cloud bundle manifest.json is not valid JSON.')
  }
  const rawScope =
    typeof rawManifest === 'object' && rawManifest !== null
      ? (rawManifest as { scope?: { type?: unknown } }).scope?.type
      : undefined
  if (rawScope === 'ACCOUNT') throw new CloudAccountBundleError()
  if (rawScope !== 'GROUP') {
    throw new Error(
      'This Cloud bundle does not contain a supported group scope.',
    )
  }

  const manifest = parseCloudGroupManifest(rawManifest)
  validateManifestReferences(manifest)
  const documentIssues: CloudBundleDocumentIssue[] = []
  const documents = new Map<string, Uint8Array>()
  const referencedPaths = new Set<string>()

  for (const document of manifestDocuments(manifest)) {
    if (document.status === 'MISSING') {
      if (document.path !== null) {
        documentIssues.push({
          sourceId: document.sourceId,
          path: document.path,
          message: 'A missing document must not point to a ZIP entry.',
        })
      } else {
        documentIssues.push({
          sourceId: document.sourceId,
          path: null,
          message:
            'This document was missing from the export and will be skipped.',
        })
      }
      continue
    }
    if (!document.path || !isSafeArchivePath(document.path)) {
      documentIssues.push({
        sourceId: document.sourceId,
        path: document.path,
        message: 'The document path is invalid.',
      })
      continue
    }
    if (referencedPaths.has(document.path)) {
      documentIssues.push({
        sourceId: document.sourceId,
        path: document.path,
        message: 'Two documents reference the same ZIP entry.',
      })
      continue
    }
    referencedPaths.add(document.path)
    const bytes = extracted.get(document.path)
    if (!bytes) {
      documentIssues.push({
        sourceId: document.sourceId,
        path: document.path,
        message: 'The included document is missing from the ZIP.',
      })
      continue
    }
    const checksum = await sha256(bytes)
    if (
      document.sizeBytes !== bytes.byteLength ||
      document.sha256 !== checksum
    ) {
      documentIssues.push({
        sourceId: document.sourceId,
        path: document.path,
        message:
          'The included document failed its size or checksum validation.',
      })
      continue
    }
    documents.set(document.sourceId, bytes)
  }

  return { kind: 'GROUP', manifest, documents, documentIssues }
}
