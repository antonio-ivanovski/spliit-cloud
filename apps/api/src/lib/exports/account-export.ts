import {
  personalExportManifestSchema,
  personalExportTransactionSchema,
  spliitAccountExportManifestSchema,
  spliitGroupExportManifestSchema,
  type PersonalExportManifest,
  type PersonalExportTransaction,
  type SpliitAccountExportManifest,
  type SpliitGroupExportManifest,
} from '@spliit/domain/export-manifest'

import { isPlaceholderEmail } from '../invitations/display'
import type {
  AccountExportSource,
  PersonalExportSource,
} from './account-snapshot'
import { createExportArchiveStream, type ExportManifestEntry } from './archive'
import { safeArchiveSegment } from './archive-path'
import {
  createGroupExportSnapshot,
  groupDisplayNameForViewer,
  type GroupExportSource,
} from './group-snapshot'
import type {
  ExportArchiveEntry,
  ExportArtifact,
  ExportDocumentReader,
  ExportSnapshotDocument,
} from './types'

function safePersonalFileName(fileName: string | null): string {
  const cleaned = (fileName ?? 'document')
    .normalize('NFKC')
    .replace(/^\.\.[/\\]/, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .split('')
    .map((character) => (character.charCodeAt(0) <= 0x1f ? '_' : character))
    .join('')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    .trim()
  return cleaned || 'document'
}

export function personalDocumentPath(
  documentId: string,
  fileName: string | null,
): string {
  return `personal/documents/${safeArchiveSegment(documentId, 'document')}__${safePersonalFileName(fileName)}`
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function toPersonalTransactionRecord(
  row: PersonalExportSource['transactions'][number],
): PersonalExportTransaction {
  return personalExportTransactionSchema.parse({
    sourceId: row.id,
    kind: row.kind,
    amount: row.amount,
    currencyCode: row.currencyCode,
    originalAmount: row.originalAmount,
    originalCurrency: row.originalCurrency,
    conversionRate: row.conversionRate,
    conversionSource: row.conversionSource,
    date: dateOnly(row.date),
    categoryId: row.categoryId,
    title: row.title,
    note: row.note,
    version: row.version,
    source: row.source,
    sourceExpenseId: row.sourceExpenseId,
    sourceGroupId: row.sourceGroupId,
    sourceGroupName: row.sourceGroupName,
    sourceDetachedAt: row.sourceDetachedAt?.toISOString() ?? null,
    personalRecurringSeriesId: row.personalRecurringSeriesId,
    recurrenceSequence: row.recurrenceSequence,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

function emptyAccountPreference() {
  return {
    defaultCurrencyCode: null,
    timeZone: null,
    locale: null,
    theme: null,
    mascot: 'bill' as const,
    notificationsEnabled: null,
    aiFeaturesEnabled: null,
    aiCategoryExtractEnabled: null,
    aiReceiptScanEnabled: null,
    aiVoiceExpenseEnabled: null,
    groupTabOrder: null,
    hiddenGroupTabs: null,
    destructiveConfirmationLevel: null,
  }
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
    includePersonal?: boolean
    signal?: AbortSignal
  },
): ExportArtifact {
  const includePersonal = options.includePersonal ?? source.personal != null
  const rawPersonal = includePersonal ? (source.personal ?? null) : null
  // An explicit `includePersonal: true` with no loaded slice still emits an
  // empty personal manifest so personal-only exports are self-describing.
  const personalSource =
    rawPersonal ??
    (includePersonal && options.includePersonal === true
      ? {
          profile: null,
          transactions: [],
          budgets: [],
          rules: [],
          overrides: [],
          importSources: [],
          recurringSeries: [],
          attachments: [],
        }
      : null)
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
        version: 2,
        scope: { type: 'GROUP', sourceId: selected.source.id },
        exportedAt,
        ...snapshot,
      },
      documents,
      manifestPath: `${groupPrefix}/manifest.json`,
      displayName: groupDisplayNameForViewer(
        selected.source,
        source.account.id,
      ),
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
        personalSplitPresets: (
          selected.preference.personalSplitPresets ?? []
        ).map((preset) => ({
          sourceId: preset.id,
          name: preset.name,
          target: preset.target,
          createdAt: preset.createdAt.toISOString(),
          updatedAt: preset.updatedAt.toISOString(),
          splitMode: preset.splitMode,
          participants: preset.participants.map((row) => ({
            participantId: row.participantId,
            shares: row.shares,
          })),
        })),
        personalDefaults: {
          paidBy: {
            mode:
              selected.preference.personalDefaults?.paidByDefaultMode ??
              'INHERIT',
            presetSourceId:
              selected.preference.personalDefaults?.paidByDefaultPresetId ??
              null,
          },
          paidFor: {
            mode:
              selected.preference.personalDefaults?.paidForDefaultMode ??
              'INHERIT',
            presetSourceId:
              selected.preference.personalDefaults?.paidForDefaultPresetId ??
              null,
          },
        },
      }))
    : null

  const accountManifest: SpliitAccountExportManifest = {
    format: 'spliit.cloud/export',
    version: 2,
    scope: { type: 'ACCOUNT', sourceId: source.account.id },
    exportedAt,
    complete: true,
    warnings: [],
    contents: {
      documents: options.includeDocuments,
      accountPreferences: options.includeAccountPreferences,
      groupPreferences: options.includeGroupPreferences,
      personal: personalSource !== null,
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
    personal: null,
  }
  accountManifest.identities = uniqueIdentities(
    source,
    groupEntries.map((entry) => entry.manifest),
  )

  // Personal slice: nested manifest (deferred so attachment statuses are
  // authoritative) plus a static transactions array via additionalEntries.
  let personalManifest: PersonalExportManifest | null = null
  let personalTransactions: PersonalExportTransaction[] = []
  let personalDocuments: ExportSnapshotDocument[] = []
  const personalManifestPath = 'personal/manifest.json'
  const personalTransactionsPath = 'personal/transactions.json' as const
  if (personalSource) {
    personalTransactions = personalSource.transactions.map(
      toPersonalTransactionRecord,
    )
    const attachments = personalSource.attachments.map((document) => {
      const path = personalDocumentPath(document.id, document.fileName)
      if (!options.includeDocuments) {
        return {
          record: {
            id: document.id,
            url: document.url,
            fileName: document.fileName,
            contentType: document.contentType,
            width: document.width,
            height: document.height,
          },
          entry: {
            sourceId: document.id,
            transactionSourceId: document.personalTransactionId,
            fileName: document.fileName,
            contentType: document.contentType,
            width: document.width,
            height: document.height,
            path: null,
            status: 'OMITTED' as const,
            sizeBytes: null,
            sha256: null,
          },
        } satisfies ExportSnapshotDocument & {
          entry: PersonalExportManifest['attachments'][number]
        }
      }
      return {
        record: {
          id: document.id,
          url: document.url,
          fileName: document.fileName,
          contentType: document.contentType,
          width: document.width,
          height: document.height,
        },
        entry: {
          sourceId: document.id,
          transactionSourceId: document.personalTransactionId,
          fileName: document.fileName,
          contentType: document.contentType,
          width: document.width,
          height: document.height,
          path,
          status: 'MISSING' as const,
          sizeBytes: null,
          sha256: null,
        },
      } satisfies ExportSnapshotDocument & {
        entry: PersonalExportManifest['attachments'][number]
      }
    })
    personalDocuments = attachments
    const personalManifestRaw = {
      profile: personalSource.profile
        ? {
            currencyCode: personalSource.profile.currencyCode,
            timeZone: personalSource.profile.timeZone,
            sharedEnabled: personalSource.profile.sharedEnabled,
            createdAt: personalSource.profile.createdAt.toISOString(),
            updatedAt: personalSource.profile.updatedAt.toISOString(),
          }
        : null,
      budgets: personalSource.budgets.map((row) => ({
        sourceId: row.id,
        name: row.name,
        amount: row.amount,
        currencyCode: row.currencyCode,
        period: row.period,
        timeZone: row.timeZone,
        categoryScope: row.categoryScope,
        categoryIds: row.categoryIds,
        startDay: row.startDay,
        archived: row.archived,
        archivedAt: row.archivedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      rules: personalSource.rules.map((row) => ({
        sourceId: row.id,
        groupId: row.groupId,
        included: row.included,
        includeFrom: row.includeFrom ? dateOnly(row.includeFrom) : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      overrides: personalSource.overrides.map((row) => ({
        sourceId: row.id,
        expenseId: row.expenseId,
        state: row.state,
        categoryId: row.categoryId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      importSources: personalSource.importSources.map((row) => ({
        transactionSourceId: row.personalTransactionId,
        provider: row.provider,
        importKey: row.importKey,
        externalIdentityHash: row.externalIdentityHash,
        semanticHash: row.semanticHash,
        rawHash: row.rawHash,
        importedByAccountId: row.importedByAccountId,
        createdAt: row.createdAt.toISOString(),
      })),
      recurringSeries: personalSource.recurringSeries.map((row) => ({
        sourceId: row.id,
        timeZone: row.timeZone,
        frequency: row.frequency,
        interval: row.interval,
        anchorDate: dateOnly(row.anchorDate),
        anchorSequence: row.anchorSequence,
        nextOccurrenceDate: dateOnly(row.nextOccurrenceDate),
        nextOccurrenceOrdinal: row.nextOccurrenceOrdinal,
        endType: row.endType,
        occurrenceLimit: row.occurrenceLimit,
        endDate: row.endDate ? dateOnly(row.endDate) : null,
        occurrencesCreated: row.occurrencesCreated,
        status: row.status,
        kind: row.kind,
        amount: row.amount,
        currencyCode: row.currencyCode,
        categoryId: row.categoryId,
        title: row.title,
        note: row.note,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      attachments: attachments.map((document) => document.entry),
      counts: {
        transactions: personalTransactions.length,
        budgets: personalSource.budgets.length,
        rules: personalSource.rules.length,
        overrides: personalSource.overrides.length,
        importSources: personalSource.importSources.length,
        recurringSeries: personalSource.recurringSeries.length,
        attachments: attachments.length,
      },
      warnings: [],
      transactionsPath: personalTransactionsPath,
      transactionCount: personalTransactions.length,
      complete: true,
      exportedAt,
    }
    // Validate early for fail-fast, but keep the raw object so deferred
    // document reads mutate the same attachment entries the manifest holds.
    personalExportManifestSchema.parse(personalManifestRaw)
    personalManifest = personalManifestRaw as PersonalExportManifest
    accountManifest.personal = {
      manifestPath: personalManifestPath,
      transactionCount: personalManifest.transactionCount,
      budgetCount: personalSource.budgets.length,
      ruleCount: personalSource.rules.length,
      overrideCount: personalSource.overrides.length,
      recurringCount: personalSource.recurringSeries.length,
      attachmentCount: attachments.length,
      warningCount: 0,
      complete: true,
    }
  }

  const documents = [
    ...groupEntries.flatMap((entry) =>
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
            type: 'MISSING_DOCUMENT' as const,
            documentId: document.entry.sourceId,
            path: intendedPath,
          })
          accountManifest.warnings.push({
            type: 'MISSING_DOCUMENT' as const,
            groupSourceId: entry.group.id,
            documentId: document.entry.sourceId,
            path: intendedPath,
          })
        },
      })),
    ),
    ...personalDocuments.map((document) => ({
      ...document,
      markMissing(intendedPath: string) {
        // Personal warnings stay in the nested personal manifest so old
        // account readers (which require `groupSourceId` on every root
        // warning) keep validating. Root completeness still flips.
        if (personalManifest) {
          personalManifest.complete = false
          personalManifest.warnings.push({
            type: 'MISSING_DOCUMENT' as const,
            documentId: document.entry.sourceId,
            path: intendedPath,
          })
        }
        accountManifest.complete = false
        if (accountManifest.personal) {
          accountManifest.personal.complete = false
          accountManifest.personal.warningCount += 1
        }
      },
    })),
  ]

  const manifests: Array<ExportManifestEntry<unknown>> = [
    ...groupEntries.map((entry) => ({
      path: entry.manifestPath,
      manifest: entry.manifest,
      validateManifest: (value: unknown) =>
        spliitGroupExportManifestSchema.parse(value),
    })),
    ...(personalManifest
      ? [
          {
            path: personalManifestPath,
            manifest: personalManifest,
            validateManifest: (value: unknown) =>
              personalExportManifestSchema.parse(value),
          },
        ]
      : []),
    {
      path: 'manifest.json',
      manifest: accountManifest,
      validateManifest: (value: unknown) =>
        spliitAccountExportManifestSchema.parse(value),
    },
  ]

  const additionalEntries: ExportArchiveEntry[] = personalManifest
    ? [
        {
          path: personalTransactionsPath,
          bytes: new TextEncoder().encode(
            JSON.stringify(personalTransactions, null, 2),
          ),
        },
      ]
    : []

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
      additionalEntries,
      signal: options.signal,
    }),
  }
}
