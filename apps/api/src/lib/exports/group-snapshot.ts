import { type Prisma, prisma } from '@spliit/db'
import type {
  SpliitExportDocument,
  SpliitGroupExportSnapshot,
} from '@spliit/domain/export-manifest'

import { isPlaceholderEmail } from '../invitations/display'
import type { ExportDocumentRecord, ExportSnapshotDocument } from './types'

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return compareText(left.id, right.id)
}

function byCreatedAtThenId<T extends { id: string; createdAt: Date }>(
  left: T,
  right: T,
): number {
  return (
    left.createdAt.getTime() - right.createdAt.getTime() || byId(left, right)
  )
}

function sorted<T>(values: ReadonlyArray<T>, compare: (a: T, b: T) => number) {
  return [...values].sort(compare)
}

function safeFileName(fileName: string | null): string {
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

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_') || 'document'
}

function safeArchivePrefix(prefix: string): string {
  return prefix.split('/').filter(Boolean).map(safePathSegment).join('/')
}

export function groupDocumentPath(
  document: ExportDocumentRecord,
  expenseId: string | null,
  archivePrefix = '',
): string {
  const owner = expenseId ? safePathSegment(expenseId) : '_orphans'
  const path = `documents/${owner}/${safePathSegment(document.id)}__${safeFileName(document.fileName)}`
  const prefix = safeArchivePrefix(archivePrefix)
  return prefix ? `${prefix}/${path}` : path
}

function shareRows(
  rows: ReadonlyArray<{ ledgerParticipantId: string; shares: number }>,
) {
  return sorted(rows, (left, right) =>
    compareText(left.ledgerParticipantId, right.ledgerParticipantId),
  ).map((row) => ({
    participantId: row.ledgerParticipantId,
    shares: row.shares,
  }))
}

function newDocumentEntry(
  document: ExportDocumentRecord,
  expenseId: string | null,
  archivePrefix: string,
): SpliitExportDocument {
  return {
    sourceId: document.id,
    fileName: document.fileName,
    contentType: document.contentType,
    width: document.width,
    height: document.height,
    path: groupDocumentPath(document, expenseId, archivePrefix),
    status: 'MISSING',
    sizeBytes: null,
    sha256: null,
  }
}

export async function loadGroupExportSource(
  groupId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return client.group.findUnique({
    where: { id: groupId },
    include: {
      ledger: {
        include: {
          participants: {
            orderBy: { id: 'asc' },
            include: {
              groupMember: {
                include: {
                  account: { select: { id: true, name: true, email: true } },
                },
              },
              invitations: {
                select: { temporaryName: true, type: true, email: true },
                take: 1,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              },
            },
          },
          recurringExpenseSeries: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
          documents: { orderBy: { id: 'asc' } },
          expenses: {
            orderBy: [
              { expenseDate: 'asc' },
              { createdAt: 'asc' },
              { id: 'asc' },
            ],
            include: {
              paidByList: { orderBy: { ledgerParticipantId: 'asc' } },
              paidFor: { orderBy: { ledgerParticipantId: 'asc' } },
              documents: { orderBy: { id: 'asc' } },
              comments: {
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                include: { authorAccount: { select: { id: true } } },
              },
              items: {
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                include: {
                  paidFor: { orderBy: { ledgerParticipantId: 'asc' } },
                },
              },
              itemizedRemainder: {
                include: {
                  paidFor: { orderBy: { ledgerParticipantId: 'asc' } },
                },
              },
            },
          },
        },
      },
      subgroups: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          members: { orderBy: { ledgerParticipantId: 'asc' } },
        },
      },
      budgets: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    },
  })
}

export type GroupExportSource = NonNullable<
  Awaited<ReturnType<typeof loadGroupExportSource>>
>
type GroupExportParticipant =
  GroupExportSource['ledger']['participants'][number]

function participantDisplayName(participant: GroupExportParticipant): string {
  return (
    participant.groupMember?.account?.name ??
    participant.invitations[0]?.temporaryName ??
    participant.displayName ??
    'Pending invite'
  )
}

function participantIdentity(participant: GroupExportParticipant) {
  if (participant.groupMember?.account) {
    return {
      kind: 'ACCOUNT' as const,
      accountId: participant.groupMember.account.id,
      name: participant.groupMember.account.name,
      email: participant.groupMember.account.email || null,
    }
  }
  const invitation = participant.invitations[0]
  if (invitation?.type === 'EMAIL' && !isPlaceholderEmail(invitation.email)) {
    return { kind: 'EMAIL' as const, email: invitation.email }
  }
  return undefined
}

export function createGroupExportSnapshot(
  group: GroupExportSource,
  options: { archivePrefix?: string } = {},
): {
  snapshot: SpliitGroupExportSnapshot
  documents: ExportSnapshotDocument[]
} {
  const archivePrefix = options.archivePrefix ?? ''
  const participantByAccountId = new Map(
    group.ledger.participants
      .filter((participant) => participant.groupMember)
      .map((participant) => [
        participant.groupMember!.accountId,
        participant.id,
      ]),
  )

  const documents: ExportSnapshotDocument[] = []
  const mapDocument = (
    document: ExportDocumentRecord,
    expenseId: string | null,
  ) => {
    const entry = newDocumentEntry(document, expenseId, archivePrefix)
    documents.push({ record: document, entry })
    return entry
  }

  const expenses = sorted(group.ledger.expenses, (left, right) => {
    return (
      left.expenseDate.getTime() - right.expenseDate.getTime() ||
      left.createdAt.getTime() - right.createdAt.getTime() ||
      byId(left, right)
    )
  }).map((expense) => ({
    sourceId: expense.id,
    createdAt: expense.createdAt.toISOString(),
    expenseDate: dateOnly(expense.expenseDate),
    title: expense.title,
    categoryId: expense.categoryId,
    amount: expense.amount,
    originalAmount: expense.originalAmount,
    originalCurrency: expense.originalCurrency,
    conversionRate: expense.conversionRate,
    conversionSource: expense.conversionSource,
    paidBySplitMode: expense.paidBySplitMode,
    isReimbursement: expense.isReimbursement,
    splitMode: expense.splitMode,
    version: expense.version,
    createdByParticipantId: expense.createdByAccountId
      ? (participantByAccountId.get(expense.createdByAccountId) ?? null)
      : null,
    recurringSeriesId: expense.recurringSeriesId,
    recurrenceSequence: expense.recurrenceSequence,
    notes: expense.notes,
    paidByList: shareRows(expense.paidByList),
    paidFor: shareRows(expense.paidFor),
    items: sorted(expense.items, byCreatedAtThenId).map((item) => ({
      sourceId: item.id,
      title: item.title,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      amount: item.amount,
      splitMode: item.splitMode,
      paidFor: shareRows(item.paidFor),
      notes: item.notes,
      createdAt: item.createdAt.toISOString(),
    })),
    itemizedRemainder: expense.itemizedRemainder
      ? {
          splitMode: expense.itemizedRemainder.splitMode,
          paidFor: shareRows(expense.itemizedRemainder.paidFor),
        }
      : null,
    documents: sorted(expense.documents, byId).map((document) =>
      mapDocument(document, expense.id),
    ),
    comments: sorted(expense.comments, byCreatedAtThenId).map((comment) => ({
      sourceId: comment.id,
      authorName: comment.authorName,
      authorParticipantId: comment.authorAccount
        ? (participantByAccountId.get(comment.authorAccount.id) ?? null)
        : null,
      text: comment.text,
      createdAt: comment.createdAt.toISOString(),
    })),
  }))

  const attachedDocumentIds = new Set(
    expenses.flatMap((expense) =>
      expense.documents.map((document) => document.sourceId),
    ),
  )

  const snapshot: SpliitGroupExportSnapshot = {
    complete: true,
    warnings: [],
    group: {
      sourceId: group.id,
      name: group.name,
      information: group.information,
      archived: group.archived,
      groupType: group.groupType,
      subgroupsEnabled: group.subgroupsEnabled,
      createdAt: group.createdAt.toISOString(),
      ledger: {
        sourceId: group.ledger.id,
        currency: group.ledger.currency,
        currencyCode: group.ledger.currencyCode,
        createdAt: group.ledger.createdAt.toISOString(),
      },
    },
    participants: sorted(group.ledger.participants, byId).map(
      (participant) => ({
        sourceId: participant.id,
        kind: participant.kind,
        displayName: participantDisplayName(participant),
        identity: participantIdentity(participant),
        removedAt: iso(participant.removedAt),
        membership: participant.groupMember
          ? {
              role: participant.groupMember.role,
              status: participant.groupMember.status,
              joinedAt: iso(participant.groupMember.joinedAt),
              leftAt: iso(participant.groupMember.leftAt),
              createdAt: participant.groupMember.createdAt.toISOString(),
              updatedAt: participant.groupMember.updatedAt.toISOString(),
            }
          : null,
      }),
    ),
    subgroups: sorted(group.subgroups, byCreatedAtThenId).map((subgroup) => ({
      sourceId: subgroup.id,
      name: subgroup.name,
      createdAt: subgroup.createdAt.toISOString(),
      updatedAt: subgroup.updatedAt.toISOString(),
      participantIds: sorted(subgroup.members, (left, right) =>
        compareText(left.ledgerParticipantId, right.ledgerParticipantId),
      ).map((member) => member.ledgerParticipantId),
    })),
    budgets: sorted(group.budgets, byCreatedAtThenId).map((budget) => ({
      sourceId: budget.id,
      name: budget.name,
      amount: budget.amount,
      period: budget.period,
      timeZone: budget.timeZone,
      customStartDate: budget.customStartDate
        ? dateOnly(budget.customStartDate)
        : null,
      customEndDate: budget.customEndDate
        ? dateOnly(budget.customEndDate)
        : null,
      categoryScope: budget.categoryScope,
      categoryNodeIds: [...budget.categoryNodeIds].sort(compareText),
      participantScope: budget.participantScope,
      participantIds: [...budget.participantIds].sort(compareText),
      notifyTrending: budget.notifyTrending,
      notifyOver: budget.notifyOver,
      archived: budget.archived,
      archivedAt: iso(budget.archivedAt),
      createdAt: budget.createdAt.toISOString(),
      updatedAt: budget.updatedAt.toISOString(),
    })),
    recurrenceSeries: sorted(
      group.ledger.recurringExpenseSeries,
      byCreatedAtThenId,
    ).map((series) => ({
      sourceId: series.id,
      creatorParticipantId: series.creatorAccountId
        ? (participantByAccountId.get(series.creatorAccountId) ?? null)
        : null,
      timeZone: series.timeZone,
      frequency: series.frequency,
      interval: series.interval,
      anchorDate: dateOnly(series.anchorDate),
      anchorSequence: series.anchorSequence,
      nextOccurrenceDate: dateOnly(series.nextOccurrenceDate),
      nextOccurrenceOrdinal: series.nextOccurrenceOrdinal,
      endType: series.endType,
      occurrenceLimit: series.occurrenceLimit,
      endDate: series.endDate ? dateOnly(series.endDate) : null,
      occurrencesCreated: series.occurrencesCreated,
      status: series.status,
      template: series.template as never,
      version: series.version,
      createdAt: series.createdAt.toISOString(),
      updatedAt: series.updatedAt.toISOString(),
    })),
    expenses,
    orphanDocuments: sorted(group.ledger.documents, byId)
      .filter((document) => !attachedDocumentIds.has(document.id))
      .map((document) => mapDocument(document, null)),
  }

  return { snapshot, documents }
}
