import type {
  NormalizedSource,
  NormalizedSourceExpense,
  NormalizedSourceParticipant,
} from './types'

export type DestinationParticipant = {
  id: string
  name: string
  pending: boolean
  unlinked: boolean
}

export type ParticipantMappingMode =
  | 'LINK_ACCOUNT'
  | 'INVITE_BY_EMAIL'
  | 'INVITE_BY_LINK'
  | 'UNLINKED_PARTICIPANT'
  | 'LINK_EXISTING_PARTICIPANT'

export type ParticipantMappingState = {
  key: string
  source: NormalizedSourceParticipant
  mode: ParticipantMappingMode
  linkedAccountId?: string
  inviteEmail?: string
  existingLedgerParticipantId?: string
}

export type ImportBatchState = {
  source: NormalizedSource | null
  mode: 'NEW_GROUP' | 'EXISTING_GROUP' | null
  targetGroupId: string | null
  groupFormValues: {
    name: string
    information: string
    currency: string
    currencyCode: string
  }
  participants: ParticipantMappingState[]
  sourceIdToDestId: Record<string, string>
  destIds: Record<string, string>
  resolvedExpenses: NormalizedSourceExpense[]
}

export function substringsOverlap(a: string, b: string): boolean {
  const aLower = a.trim().toLowerCase()
  const bLower = b.trim().toLowerCase()
  if (!aLower || !bLower) return false
  return aLower.includes(bLower) || bLower.includes(aLower)
}

export function findBestNameMatch(
  sourceName: string,
  candidates: DestinationParticipant[],
): DestinationParticipant | null {
  const source = sourceName.toLowerCase()
  if (!source) return null

  for (const c of candidates) {
    if (c.name.toLowerCase() === source) return c
  }

  let best: DestinationParticipant | null = null
  let bestScore = -1
  for (const c of candidates) {
    const cLower = c.name.toLowerCase()
    if (cLower.includes(source) || source.includes(cLower)) {
      const score = Math.min(source.length, cLower.length)
      if (score > bestScore) {
        best = c
        bestScore = score
      }
    }
  }
  return best
}

export function applyAutoMatch(
  participants: ParticipantMappingState[],
  destinationParticipants: DestinationParticipant[],
): ParticipantMappingState[] {
  let changed = false
  const next = participants.map((p, i) => {
    if (i === 0 || p.mode !== 'INVITE_BY_EMAIL') return p
    const match = findBestNameMatch(
      p.source.sourceName,
      destinationParticipants,
    )
    if (!match) return p
    changed = true
    return {
      ...p,
      mode: 'LINK_EXISTING_PARTICIPANT' as const,
      existingLedgerParticipantId: match.id,
      inviteEmail: undefined,
      linkedAccountId: undefined,
    }
  })
  return changed ? next : participants
}

export function findImportConflicts(
  participants: ParticipantMappingState[],
  destinationParticipants?: DestinationParticipant[],
): Map<string, string> {
  const conflicts = new Map<string, string>()

  const linkExistingRows = participants.filter(
    (p) =>
      p.mode === 'LINK_EXISTING_PARTICIPANT' && !!p.existingLedgerParticipantId,
  )

  const byLp = new Map<string, ParticipantMappingState[]>()
  for (const row of linkExistingRows) {
    const list = byLp.get(row.existingLedgerParticipantId!) ?? []
    list.push(row)
    byLp.set(row.existingLedgerParticipantId!, list)
  }
  for (const rows of byLp.values()) {
    if (rows.length < 2) continue
    for (const row of rows) {
      if (!conflicts.has(row.key)) {
        conflicts.set(
          row.key,
          'Two source rows are mapped to the same existing member.',
        )
      }
    }
  }

  if (destinationParticipants) {
    const destById = new Map(destinationParticipants.map((d) => [d.id, d]))

    for (const row of participants) {
      if (row.mode !== 'INVITE_BY_EMAIL') continue
      const emailRaw = row.inviteEmail?.trim()
      if (!emailRaw) continue
      const email = emailRaw.toLowerCase()
      for (const other of linkExistingRows) {
        if (other.key === row.key) continue
        const dest = destById.get(other.existingLedgerParticipantId!)
        if (!dest) continue
        const name = dest.name.trim().toLowerCase()
        if (!name) continue
        if (!substringsOverlap(email, name)) continue
        conflicts.set(
          row.key,
          dest.pending
            ? `You're inviting ${emailRaw} but they're already a pending invite; link to them instead.`
            : `You're inviting ${emailRaw} but they're already a member of this group; link to them instead.`,
        )
        break
      }
    }

    for (let i = 0; i < linkExistingRows.length; i++) {
      for (let j = i + 1; j < linkExistingRows.length; j++) {
        const a = linkExistingRows[i]
        const b = linkExistingRows[j]
        if (a.existingLedgerParticipantId === b.existingLedgerParticipantId)
          continue
        const destA = destById.get(a.existingLedgerParticipantId!)
        const destB = destById.get(b.existingLedgerParticipantId!)
        if (!destA || !destB) continue
        if (destA.name.trim().length < 2 || destB.name.trim().length < 2)
          continue
        if (!substringsOverlap(destA.name, destB.name)) continue
        if (!conflicts.has(a.key)) {
          conflicts.set(
            a.key,
            'Two existing members look like the same person — pick one.',
          )
        }
        if (!conflicts.has(b.key)) {
          conflicts.set(
            b.key,
            'Two existing members look like the same person — pick one.',
          )
        }
      }
    }
  }

  return conflicts
}

export function buildImportBatch(
  state: ImportBatchState,
  destinationCurrencyCode: string,
): {
  batch:
    | {
        targetGroupId: string
        participants: ImportBatchParticipant[]
        expenses: ImportBatchExpense[]
      }
    | {
        groupFormValues: {
          name: string
          information: string | undefined
          currency: string
          currencyCode: string
          participants: Array<{ name: string }>
        }
        participants: ImportBatchParticipant[]
        expenses: ImportBatchExpense[]
      }
} {
  const participants: ImportBatchParticipant[] = state.participants.map((p) => {
    const destLedgerParticipantId =
      p.mode === 'LINK_EXISTING_PARTICIPANT'
        ? (p.existingLedgerParticipantId ?? '')
        : (state.destIds[p.source.sourceId] ?? '')
    if (!destLedgerParticipantId) {
      throw new Error(
        `Missing destination id for source participant "${p.source.sourceName}"`,
      )
    }
    if (p.mode === 'UNLINKED_PARTICIPANT') {
      return {
        mode: 'UNLINKED_PARTICIPANT' as const,
        sourceName: p.source.sourceName,
        destLedgerParticipantId,
      }
    }
    if (p.mode === 'INVITE_BY_EMAIL') {
      if (!p.inviteEmail?.trim()) {
        throw new Error(`Missing email for invitee "${p.source.sourceName}"`)
      }
      return {
        mode: 'INVITE_BY_EMAIL' as const,
        sourceName: p.source.sourceName,
        email: p.inviteEmail.trim(),
        destLedgerParticipantId,
      }
    }
    if (p.mode === 'INVITE_BY_LINK') {
      return {
        mode: 'INVITE_BY_LINK' as const,
        sourceName: p.source.sourceName,
        destLedgerParticipantId,
      }
    }
    if (p.mode === 'LINK_EXISTING_PARTICIPANT') {
      return {
        mode: 'LINK_EXISTING_PARTICIPANT' as const,
        sourceName: p.source.sourceName,
        destLedgerParticipantId,
      }
    }
    if (!p.linkedAccountId) {
      throw new Error(
        `Missing account for linked participant "${p.source.sourceName}"`,
      )
    }
    return {
      mode: 'LINK_ACCOUNT' as const,
      sourceName: p.source.sourceName,
      linkedAccountId: p.linkedAccountId,
      destLedgerParticipantId,
    }
  })

  const expenses: ImportBatchExpense[] = state.resolvedExpenses.map((e) => {
    const paidBy = state.sourceIdToDestId[e.paidBySourceId]
    if (!paidBy) {
      throw new Error(
        `Missing destination id for paidBy participant ${e.paidBySourceId}`,
      )
    }
    const paidFor: Array<{ participant: string; shares: number }> = []
    for (const p of e.paidFor) {
      const destId = state.sourceIdToDestId[p.sourceId]
      if (!destId) {
        throw new Error(
          `Missing destination id for paidFor participant ${p.sourceId}`,
        )
      }
      paidFor.push({ participant: destId, shares: p.shares })
    }
    const sourceCurrencyCode = state.source?.currencyCode ?? ''
    const crossCurrency =
      !!sourceCurrencyCode &&
      !!destinationCurrencyCode &&
      sourceCurrencyCode !== destinationCurrencyCode

    return {
      expenseDate: new Date(e.expenseDate),
      title: e.title,
      category: e.category as never,
      amount: e.amount,
      originalAmount: crossCurrency
        ? e.amount
        : (e.originalAmount ?? undefined),
      originalCurrency: crossCurrency
        ? sourceCurrencyCode || state.source?.currency || undefined
        : (e.originalCurrency ?? undefined),
      conversionRate: crossCurrency ? 1 : (e.conversionRate ?? undefined),
      paidBy,
      paidFor,
      splitMode: e.splitMode,
      saveDefaultSplittingOptions: false,
      isReimbursement: e.isReimbursement,
      documents: [],
      notes: e.notes ?? undefined,
      recurrenceRule: e.recurrenceRule,
    }
  })

  const batch =
    state.mode === 'EXISTING_GROUP' && state.targetGroupId
      ? { targetGroupId: state.targetGroupId, participants, expenses }
      : {
          groupFormValues: {
            name: state.groupFormValues.name,
            information: state.groupFormValues.information || undefined,
            currency: state.groupFormValues.currency,
            currencyCode: state.groupFormValues.currencyCode || '',
            participants: [{ name: 'Owner' }],
          },
          participants,
          expenses,
        }

  return { batch }
}

export type ImportBatchParticipant =
  | {
      mode: 'LINK_ACCOUNT'
      sourceName: string
      linkedAccountId: string
      destLedgerParticipantId: string
    }
  | {
      mode: 'INVITE_BY_EMAIL'
      sourceName: string
      email: string
      destLedgerParticipantId: string
    }
  | {
      mode: 'INVITE_BY_LINK'
      sourceName: string
      destLedgerParticipantId: string
    }
  | {
      mode: 'UNLINKED_PARTICIPANT'
      sourceName: string
      destLedgerParticipantId: string
    }
  | {
      mode: 'LINK_EXISTING_PARTICIPANT'
      sourceName: string
      destLedgerParticipantId: string
    }

export type ImportBatchExpense = {
  expenseDate: Date
  title: string
  category: never
  amount: number
  originalAmount: number | undefined
  originalCurrency: string | undefined
  conversionRate: number | undefined
  paidBy: string
  paidFor: Array<{ participant: string; shares: number }>
  splitMode: 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE' | 'BY_AMOUNT'
  saveDefaultSplittingOptions: boolean
  isReimbursement: boolean
  documents: never[]
  notes: string | undefined
  recurrenceRule: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'
}
