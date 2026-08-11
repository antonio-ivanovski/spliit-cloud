import {
  spliitAccountExportManifestSchema,
  spliitGroupExportManifestSchema,
  type SpliitAccountExportManifest,
  type SpliitGroupExportManifest,
} from '@spliit/domain/export-manifest'

import { isPlaceholderEmail } from '../invitations/display'
import type { AccountExportSource } from './account-snapshot'
import { createExportArchiveStream, type ExportManifestEntry } from './archive'
import { safeArchiveSegment } from './archive-path'
import {
  createGroupExportSnapshot,
  type GroupExportSource,
} from './group-snapshot'
import type {
  ExportArtifact,
  ExportDocumentReader,
  ExportSnapshotDocument,
} from './types'

function emptyAccountPreference() {
  return {
    defaultCurrencyCode: null,
    timeZone: null,
    locale: null,
    theme: null,
    aiFeaturesEnabled: null,
    aiCategoryExtractEnabled: null,
    aiReceiptScanEnabled: null,
    aiVoiceExpenseEnabled: null,
  }
}

function displayNameForGroup(group: GroupExportSource, accountId: string) {
  if (group.name) return group.name
  return (
    group.ledger.participants.find(
      (participant) =>
        participant.groupMember?.account?.id !== accountId &&
        participant.groupMember?.account?.name,
    )?.groupMember?.account?.name ?? 'Friend ledger'
  )
}

function uniqueIdentities(
  source: AccountExportSource,
  snapshots: ReadonlyArray<SpliitGroupExportManifest>,
) {
  const identities = new Map<
    string,
    { sourceId: string; name: string; email: string | null }
  >()
  identities.set(source.account.id, {
    sourceId: source.account.id,
    name: source.account.name,
    email: isPlaceholderEmail(source.account.email)
      ? null
      : source.account.email,
  })
  for (const snapshot of snapshots) {
    for (const participant of snapshot.participants) {
      if (participant.identity?.kind !== 'ACCOUNT') continue
      identities.set(participant.identity.accountId, {
        sourceId: participant.identity.accountId,
        name: participant.identity.name,
        email: participant.identity.email,
      })
    }
  }
  return [...identities.values()].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId),
  )
}

type GroupManifestEntry = {
  group: GroupExportSource
  manifest: SpliitGroupExportManifest
  documents: ExportSnapshotDocument[]
  manifestPath: string
  displayName: string
}

export function createAccountExportArtifact(
  source: AccountExportSource,
  options: {
    exportedAt: Date
    documentReader: ExportDocumentReader
    includeDocuments: boolean
    includeAccountPreferences: boolean
    includeGroupPreferences: boolean
    signal?: AbortSignal
  },
): ExportArtifact {
  const exportedAt = options.exportedAt.toISOString()
  const groupEntries: GroupManifestEntry[] = []
  const usedGroupPrefixes = new Set<string>()

  for (const selected of source.groups) {
    const groupPrefix = `groups/${safeArchiveSegment(selected.source.id, 'group')}`
    if (usedGroupPrefixes.has(groupPrefix)) {
      throw new Error(`Duplicate account export group path: ${groupPrefix}`)
    }
    usedGroupPrefixes.add(groupPrefix)
    const { snapshot, documents } = createGroupExportSnapshot(selected.source, {
      archivePrefix: groupPrefix,
    })
    if (!options.includeDocuments) {
      for (const document of documents) {
        document.entry.status = 'OMITTED'
        document.entry.path = null
        document.entry.sizeBytes = null
        document.entry.sha256 = null
      }
    }
    groupEntries.push({
      group: selected.source,
      manifest: {
        format: 'spliit.cloud/export',
        version: 1,
        scope: { type: 'GROUP', sourceId: selected.source.id },
        exportedAt,
        ...snapshot,
      },
      documents,
      manifestPath: `${groupPrefix}/manifest.json`,
      displayName: displayNameForGroup(selected.source, source.account.id),
    })
  }

  const groupIndex = groupEntries.map((entry) => ({
    sourceId: entry.group.id,
    displayName: entry.displayName,
    groupType: entry.group.groupType,
    archived: entry.group.archived,
    manifestPath: entry.manifestPath,
    complete: entry.manifest.complete,
  }))
  const groupPreferences = options.includeGroupPreferences
    ? source.groups.map((selected) => ({
        groupSourceId: selected.source.id,
        starred: selected.preference.starred,
        hidden: selected.preference.hidden,
        defaultSplit: selected.preference.defaultSplit,
      }))
    : null

  const accountManifest: SpliitAccountExportManifest = {
    format: 'spliit.cloud/export',
    version: 1,
    scope: { type: 'ACCOUNT', sourceId: source.account.id },
    exportedAt,
    complete: true,
    warnings: [],
    contents: {
      documents: options.includeDocuments,
      accountPreferences: options.includeAccountPreferences,
      groupPreferences: options.includeGroupPreferences,
    },
    account: {
      sourceId: source.account.id,
      name: source.account.name,
      email: isPlaceholderEmail(source.account.email)
        ? null
        : source.account.email,
      preferences: options.includeAccountPreferences
        ? (source.account.preference ?? emptyAccountPreference())
        : null,
      notificationPreferences: options.includeAccountPreferences
        ? source.notificationPreferences
        : null,
    },
    identities: [],
    groups: groupIndex,
    groupPreferences,
  }
  accountManifest.identities = uniqueIdentities(
    source,
    groupEntries.map((entry) => entry.manifest),
  )

  const documents = groupEntries.flatMap((entry) =>
    entry.documents.map((document) => ({
      ...document,
      markMissing(intendedPath: string) {
        entry.manifest.complete = false
        accountManifest.complete = false
        const group = accountManifest.groups.find(
          (candidate) => candidate.sourceId === entry.group.id,
        )
        if (group) group.complete = false
        entry.manifest.warnings.push({
          type: 'MISSING_DOCUMENT',
          documentId: document.entry.sourceId,
          path: intendedPath,
        })
        accountManifest.warnings.push({
          type: 'MISSING_DOCUMENT',
          groupSourceId: entry.group.id,
          documentId: document.entry.sourceId,
          path: intendedPath,
        })
      },
    })),
  )

  const manifests: Array<
    ExportManifestEntry<SpliitGroupExportManifest | SpliitAccountExportManifest>
  > = [
    ...groupEntries.map((entry) => ({
      path: entry.manifestPath,
      manifest: entry.manifest,
      validateManifest: (
        value: SpliitGroupExportManifest | SpliitAccountExportManifest,
      ) => spliitGroupExportManifestSchema.parse(value),
    })),
    {
      path: 'manifest.json',
      manifest: accountManifest,
      validateManifest: (value) =>
        spliitAccountExportManifestSchema.parse(value),
    },
  ]

  const stamp = exportedAt.replace(/\.\d{3}Z$/, 'Z').replace(/[:]/g, '-')
  return {
    fileName: `Spliit Cloud Account Export - ${stamp}.spliit.zip`,
    mediaType: 'application/zip',
    scope: accountManifest.scope,
    exportedAt,
    body: createExportArchiveStream({
      manifests,
      documents,
      documentReader: options.documentReader,
      signal: options.signal,
    }),
  }
}
