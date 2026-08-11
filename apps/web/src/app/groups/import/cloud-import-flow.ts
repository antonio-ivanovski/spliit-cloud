import type { AuthAccount } from '@/lib/auth'
import type { NormalizedSource } from '@spliit/domain/import'

import type { CloudGroupBundleInspection } from './cloud-bundle'
import type { ParticipantMappingState } from './import-wizard-state'

export type CloudStagedDocument = {
  sourceDocumentId: string
  stagedToken: string
}

export function cloudInspectionToSource(
  inspection: CloudGroupBundleInspection,
): NormalizedSource {
  const { manifest } = inspection
  return {
    provider: 'SPLIIT',
    sourceGroupId: manifest.group.sourceId,
    sourceUrl: null,
    name: manifest.group.name,
    currency: manifest.group.ledger.currency,
    currencyCode: manifest.group.ledger.currencyCode,
    participants: manifest.participants.map((participant) => ({
      sourceId: participant.sourceId,
      sourceName: participant.displayName,
    })),
    expenses: manifest.expenses.map((expense) => {
      const paidBy = expense.paidByList[0]
      return {
        sourceCreatedAt: expense.createdAt,
        title: expense.title,
        expenseDate: expense.expenseDate,
        category: expense.categoryId,
        amountCurrency: manifest.group.ledger.currencyCode,
        amount: expense.amount,
        originalAmount: expense.originalAmount,
        originalCurrency: expense.originalCurrency,
        conversionRate: expense.conversionRate,
        paidBySourceId: paidBy?.participantId ?? '',
        paidBy: expense.paidByList.map((row) => ({
          sourceId: row.participantId,
          shares: row.shares,
        })),
        paidFor: expense.paidFor.map((row) => ({
          sourceId: row.participantId,
          shares: row.shares,
        })),
        // The authoritative manifest remains untouched for the Cloud API call.
        splitMode:
          expense.splitMode === 'ITEMIZED' ? 'EVENLY' : expense.splitMode,
        recurrenceRule: 'NONE',
        recurrence: null,
        isReimbursement: expense.isReimbursement,
        notes: expense.notes,
      }
    }),
  }
}

function mappingRank(mode: ParticipantMappingState['mode']): number {
  switch (mode) {
    case 'LINK_ACCOUNT':
      return 0
    case 'INVITE_CONTACT':
    case 'LINK_EXISTING_PARTICIPANT':
      return 1
    case 'INVITE_BY_EMAIL':
      return 2
    case 'INVITE_BY_LINK':
      return 3
    case 'UNLINKED_PARTICIPANT':
      return 4
  }
}

export function sortParticipantMappings(
  participants: ParticipantMappingState[],
): ParticipantMappingState[] {
  return [...participants].sort((a, b) => {
    const rank = mappingRank(a.mode) - mappingRank(b.mode)
    if (rank !== 0) return rank
    const name = a.source.sourceName.localeCompare(
      b.source.sourceName,
      undefined,
      {
        sensitivity: 'base',
      },
    )
    if (name !== 0) return name
    return a.source.sourceId.localeCompare(b.source.sourceId)
  })
}

export function initialCloudMappings(
  source: NormalizedSource,
  inspection: CloudGroupBundleInspection,
  account: Pick<AuthAccount, 'id' | 'email' | 'name'>,
): ParticipantMappingState[] {
  const normalizedEmail = account.email?.trim().toLowerCase() ?? null
  const normalizedName = account.name?.trim().toLowerCase() ?? null
  const nameCounts = new Map<string, number>()
  for (const participant of source.participants) {
    const key = participant.sourceName.trim().toLowerCase()
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }

  const mappings = source.participants.map((participant) => {
    const exported = inspection.manifest.participants.find(
      (row) => row.sourceId === participant.sourceId,
    )
    const identity = exported?.identity
    const identityEmail =
      identity?.kind === 'ACCOUNT'
        ? (identity.email?.trim().toLowerCase() ?? null)
        : identity?.kind === 'EMAIL'
          ? identity.email.trim().toLowerCase()
          : null
    const isSelf =
      identity?.kind === 'ACCOUNT' &&
      identity.accountId === account.id &&
      identityEmail === normalizedEmail
    const isEmailMatch =
      identityEmail !== null && identityEmail === normalizedEmail
    const normalizedParticipantName = participant.sourceName
      .trim()
      .toLowerCase()
    const isNameMatch =
      normalizedName !== null &&
      nameCounts.get(normalizedParticipantName) === 1 &&
      normalizedParticipantName === normalizedName
    const linkToSelf = isSelf || isEmailMatch || isNameMatch
    const email =
      identityEmail && identityEmail !== normalizedEmail
        ? identityEmail
        : undefined

    return {
      key: `${participant.sourceId}-cloud`,
      source: participant,
      mode: linkToSelf
        ? ('LINK_ACCOUNT' as const)
        : email
          ? ('INVITE_BY_EMAIL' as const)
          : ('UNLINKED_PARTICIPANT' as const),
      linkedAccountId: linkToSelf ? account.id : undefined,
      inviteEmail: email,
    }
  })
  return sortParticipantMappings(mappings)
}

export function initialLegacyMappings(
  source: NormalizedSource,
  accountId: string | undefined,
): ParticipantMappingState[] {
  const mappings = source.participants.map((participant, index) => ({
    key: `${participant.sourceId}-${index}`,
    source: participant,
    mode:
      index === 0 ? ('LINK_ACCOUNT' as const) : ('INVITE_BY_EMAIL' as const),
    linkedAccountId: index === 0 ? accountId : undefined,
    inviteEmail: index === 0 ? undefined : '',
  }))
  return sortParticipantMappings(mappings)
}

export function toCloudApiMapping(participant: ParticipantMappingState) {
  const base = {
    sourceParticipantId: participant.source.sourceId,
    sourceName: participant.source.sourceName,
  }
  switch (participant.mode) {
    case 'LINK_ACCOUNT':
      return {
        ...base,
        mode: 'LINK_ACCOUNT' as const,
        linkedAccountId: participant.linkedAccountId ?? '',
      }
    case 'INVITE_BY_EMAIL':
      return {
        ...base,
        mode: 'INVITE_BY_EMAIL' as const,
        email: participant.inviteEmail ?? '',
      }
    case 'INVITE_CONTACT':
      return {
        ...base,
        mode: 'INVITE_CONTACT' as const,
        email: participant.inviteEmail ?? '',
      }
    case 'INVITE_BY_LINK':
      return { ...base, mode: 'INVITE_BY_LINK' as const }
    default:
      return { ...base, mode: 'UNLINKED_PARTICIPANT' as const }
  }
}
