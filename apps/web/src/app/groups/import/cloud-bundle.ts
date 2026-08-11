import { AsyncUnzipInflate, Unzip, UnzipPassThrough } from 'fflate'

import type {
  SpliitAccountExportManifest,
  SpliitGroupExportManifest,
} from '@spliit/domain'
import {
  hasZipSignature,
  parseCloudAccountManifest,
  parseCloudGroupManifest,
} from '@spliit/domain/import'

export const MAX_CLOUD_BUNDLE_BYTES = 256 * 1024 * 1024
export const MAX_CLOUD_BUNDLE_EXPANDED_BYTES = 512 * 1024 * 1024
export const MAX_CLOUD_BUNDLE_ENTRIES = 10_000
export const MAX_CLOUD_BUNDLE_MANIFEST_BYTES = 16 * 1024 * 1024
export const MAX_CLOUD_DOCUMENT_BYTES = 2 * 1024 * 1024

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

export type CloudAccountGroupInspection = {
  index: SpliitAccountExportManifest['groups'][number]
  inspection: CloudGroupBundleInspection
}

export type CloudAccountBundleInspection = {
  kind: 'ACCOUNT'
  manifest: SpliitAccountExportManifest
  groups: CloudAccountGroupInspection[]
}

export type CloudBundleInspection =
  | CloudGroupBundleInspection
  | CloudAccountBundleInspection

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

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error(`${label} is not valid JSON.`)
  }
}

function isGroupManifestEntry(path: string): boolean {
  return /^groups\/[^/]+\/manifest\.json$/.test(path)
}

function isDocumentEntry(path: string): boolean {
  return (
    path.startsWith('documents/') || /^groups\/[^/]+\/documents\//.test(path)
  )
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
    throw new Error(`Spliit Cloud manifest contains duplicate ${label} rows.`)
  }
}

function validateManifestReferences(manifest: SpliitGroupExportManifest) {
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) {
      throw new Error(`Spliit Cloud manifest contains duplicate ${label} IDs.`)
    }
  }
  if (manifest.scope.sourceId !== manifest.group.sourceId) {
    throw new Error('Spliit Cloud manifest scope does not match its group.')
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
      throw new Error(
        'Spliit Cloud manifest warning references an unknown document.',
      )
    }
    if (warning.path !== null && !isSafeArchivePath(warning.path)) {
      throw new Error('Spliit Cloud manifest warning path is unsafe.')
    }
  }
  const participantIds = new Set(
    manifest.participants.map((participant) => participant.sourceId),
  )
  const ensureParticipant = (id: string) => {
    if (!participantIds.has(id)) {
      throw new Error(
        'Spliit Cloud manifest references an unknown participant.',
      )
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
      throw new Error(
        'Spliit Cloud manifest references an unknown recurrence series.',
      )
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
        throw new Error('Spliit Cloud manifest contains duplicate comment IDs.')
      }
      commentIds.add(comment.sourceId)
      if (comment.authorParticipantId)
        ensureParticipant(comment.authorParticipantId)
    })
  }
}

async function inspectGroupManifest(
  manifest: SpliitGroupExportManifest,
  extracted: Map<string, Uint8Array>,
  archivePrefix?: string,
): Promise<CloudGroupBundleInspection> {
  validateManifestReferences(manifest)
  const documentIssues: CloudBundleDocumentIssue[] = []
  const documents = new Map<string, Uint8Array>()
  const referencedPaths = new Set<string>()

  for (const document of manifestDocuments(manifest)) {
    if (document.status === 'MISSING') {
      documentIssues.push({
        sourceId: document.sourceId,
        path: document.path,
        message:
          document.path === null
            ? 'This document was missing from the export and will be skipped.'
            : 'A missing document must not point to a ZIP entry.',
      })
      continue
    }
    if (document.status === 'OMITTED') {
      documentIssues.push({
        sourceId: document.sourceId,
        path: null,
        message:
          'This document was intentionally left out of the export and will be skipped.',
      })
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
    if (
      archivePrefix &&
      !document.path.startsWith(`${archivePrefix}/documents/`)
    ) {
      documentIssues.push({
        sourceId: document.sourceId,
        path: document.path,
        message: 'The document path does not belong to this group.',
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

/**
 * Inspect a Spliit Cloud backup in the browser without synchronously inflating
 * the archive. Only the root/nested manifests and documents referenced by them
 * are retained; viewer assets and other future entries are safely ignored.
 */
export async function inspectSpliitCloudBundle(
  input: Blob,
): Promise<CloudBundleInspection> {
  if (input.size > MAX_CLOUD_BUNDLE_BYTES) {
    throw new Error('This Spliit Cloud backup is too large to import.')
  }

  const firstChunk = new Uint8Array(await input.slice(0, 4).arrayBuffer())
  if (!hasZipSignature(firstChunk)) {
    throw new Error('This file is not a Spliit Cloud backup ZIP.')
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
      failure ??= new Error('This Spliit Cloud backup contains too many files.')
      return
    }

    const isManifest = entry.name === 'manifest.json'
    const isNestedManifest = isGroupManifestEntry(entry.name)
    const isDocument = isDocumentEntry(entry.name)
    if (!isManifest && !isNestedManifest && !isDocument) return

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
      const max =
        isManifest || isNestedManifest
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
          'Expanded Spliit Cloud backup data exceeds the import limit.',
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
              (isManifest || isNestedManifest
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
                  'Expanded Spliit Cloud backup data exceeds the import limit.',
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
  if (!manifestBytes)
    throw new Error('Spliit Cloud backup is missing manifest.json.')

  const rawManifest = parseJson(
    manifestBytes,
    'Spliit Cloud backup manifest.json',
  )
  const rawScope =
    typeof rawManifest === 'object' && rawManifest !== null
      ? (rawManifest as { scope?: { type?: unknown } }).scope?.type
      : undefined
  if (rawScope !== 'GROUP' && rawScope !== 'ACCOUNT') {
    throw new Error(
      'This Spliit Cloud backup does not contain a supported group or account scope.',
    )
  }

  if (rawScope === 'GROUP') {
    return inspectGroupManifest(parseCloudGroupManifest(rawManifest), extracted)
  }

  const manifest = parseCloudAccountManifest(rawManifest)
  const groupIds = new Set<string>()
  const manifestPaths = new Set<string>()
  for (const group of manifest.groups) {
    if (groupIds.has(group.sourceId)) {
      throw new Error(
        'Spliit Cloud account backup contains duplicate group IDs.',
      )
    }
    if (!isSafeArchivePath(group.manifestPath)) {
      throw new Error(
        'Spliit Cloud account backup contains an unsafe group path.',
      )
    }
    if (manifestPaths.has(group.manifestPath)) {
      throw new Error(
        'Spliit Cloud account backup contains duplicate group manifest paths.',
      )
    }
    groupIds.add(group.sourceId)
    manifestPaths.add(group.manifestPath)
  }
  const preferenceIds = new Set<string>()
  for (const preference of manifest.groupPreferences ?? []) {
    if (!groupIds.has(preference.groupSourceId)) {
      throw new Error(
        'Spliit Cloud account backup references an unknown group preference.',
      )
    }
    if (preferenceIds.has(preference.groupSourceId)) {
      throw new Error(
        'Spliit Cloud account backup contains duplicate group preferences.',
      )
    }
    preferenceIds.add(preference.groupSourceId)
  }

  const identityIds = new Set<string>()
  for (const identity of manifest.identities) {
    if (identityIds.has(identity.sourceId)) {
      throw new Error(
        'Spliit Cloud account backup contains duplicate identities.',
      )
    }
    identityIds.add(identity.sourceId)
  }
  if (manifest.account.sourceId !== manifest.scope.sourceId) {
    throw new Error(
      'Spliit Cloud account backup account does not match its export scope.',
    )
  }
  if (!identityIds.has(manifest.scope.sourceId)) {
    throw new Error(
      'Spliit Cloud account backup is missing the exporting account identity.',
    )
  }

  const groups: CloudAccountGroupInspection[] = []
  for (const index of manifest.groups) {
    const groupBytes = extracted.get(index.manifestPath)
    if (!groupBytes) {
      throw new Error(
        `Spliit Cloud account backup is missing ${index.manifestPath}.`,
      )
    }
    const groupManifest = parseCloudGroupManifest(
      parseJson(groupBytes, index.manifestPath),
    )
    if (groupManifest.scope.sourceId !== index.sourceId) {
      throw new Error(
        `Spliit Cloud group manifest ${index.manifestPath} does not match its index.`,
      )
    }
    if (groupManifest.complete !== index.complete) {
      throw new Error(
        `Spliit Cloud group manifest ${index.manifestPath} has inconsistent completeness.`,
      )
    }
    if (groupManifest.group.archived !== index.archived) {
      throw new Error(
        `Spliit Cloud group manifest ${index.manifestPath} has inconsistent archive state.`,
      )
    }
    if (groupManifest.group.groupType !== index.groupType) {
      throw new Error(
        `Spliit Cloud group manifest ${index.manifestPath} has inconsistent group type.`,
      )
    }
    for (const participant of groupManifest.participants) {
      if (
        participant.identity?.kind === 'ACCOUNT' &&
        !identityIds.has(participant.identity.accountId)
      ) {
        throw new Error(
          'Spliit Cloud group manifest references an identity missing from the account directory.',
        )
      }
    }
    groups.push({
      index,
      inspection: await inspectGroupManifest(
        groupManifest,
        extracted,
        index.manifestPath.slice(0, -'/manifest.json'.length),
      ),
    })
  }

  const groupBySourceId = new Map(
    groups.map((group) => [group.index.sourceId, group.inspection]),
  )
  for (const warning of manifest.warnings) {
    const group = groupBySourceId.get(warning.groupSourceId)
    if (!group) {
      throw new Error(
        'Spliit Cloud account backup warning references an unknown group.',
      )
    }
    const documentIds = new Set(
      manifestDocuments(group.manifest).map((document) => document.sourceId),
    )
    if (!documentIds.has(warning.documentId)) {
      throw new Error(
        'Spliit Cloud account backup warning references an unknown document.',
      )
    }
    if (warning.path !== null && !isSafeArchivePath(warning.path)) {
      throw new Error('Spliit Cloud account backup warning path is unsafe.')
    }
  }

  return { kind: 'ACCOUNT', manifest, groups }
}
