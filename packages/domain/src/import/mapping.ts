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
  rates?: ImportRatesByKey,
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

  const sourceCurrencyCode = state.source?.currencyCode ?? ''
  const groupCurrencyMismatch =
    !!sourceCurrencyCode &&
    !!destinationCurrencyCode &&
    sourceCurrencyCode !== destinationCurrencyCode

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

    // The "effective original" is the source expense's prior-conversion
    // metadata when present (e.g. an expense originally entered in USD
    // and converted to the source group's EUR), and otherwise the source
    // group's currency. When the source group's currency matches the
    // destination's, conversion is a no-op and we pass the source
    // expense's existing audit fields through verbatim. When it differs,
    // we look up the rate for the effective original on the expense's
    // date and convert.
    const effectiveOriginalCurrency = e.originalCurrency ?? sourceCurrencyCode
    const effectiveOriginalAmount = e.originalAmount ?? e.amount
    const needsConversion =
      groupCurrencyMismatch &&
      !!destinationCurrencyCode &&
      !!effectiveOriginalCurrency &&
      effectiveOriginalCurrency !== destinationCurrencyCode

    if (needsConversion) {
      if (!rates) {
        throw new Error(
          `Cannot import "${e.title}": cross-currency conversion needs an exchange rate from ${effectiveOriginalCurrency} to ${destinationCurrencyCode}.`,
        )
      }
      const dateKey = e.expenseDate.slice(0, 10)
      const rateKey = makeRateKey(
        dateKey,
        effectiveOriginalCurrency,
        destinationCurrencyCode,
      )
      const rate = rates[rateKey]
      if (typeof rate !== 'number') {
        throw new Error(
          `Cannot import "${e.title}": missing exchange rate for ${effectiveOriginalCurrency} -> ${destinationCurrencyCode} on ${dateKey}.`,
        )
      }
      return {
        expenseDate: new Date(e.expenseDate),
        title: e.title,
        category: e.category as never,
        amount: Math.round(effectiveOriginalAmount * rate),
        originalAmount: effectiveOriginalAmount,
        originalCurrency: effectiveOriginalCurrency,
        conversionRate: rate,
        paidBy,
        paidFor,
        splitMode: e.splitMode,
        saveDefaultSplittingOptions: false,
        isReimbursement: e.isReimbursement,
        documents: [],
        notes: e.notes ?? undefined,
        recurrenceRule: e.recurrenceRule,
      }
    }

    return {
      expenseDate: new Date(e.expenseDate),
      title: e.title,
      category: e.category as never,
      amount: e.amount,
      originalAmount: e.originalAmount ?? undefined,
      originalCurrency: e.originalCurrency ?? undefined,
      conversionRate: e.conversionRate ?? undefined,
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

/**
 * Cache key for an exchange rate lookup. Matches the format the importer
 * client uses when it builds the rates payload from a batched tRPC
 * response, so the two sides stay aligned.
 */
export function makeRateKey(
  date: string,
  base: string,
  target: string,
): string {
  return `${date}|${base.toUpperCase()}|${target.toUpperCase()}`
}

/**
 * Pre-fetched exchange rates keyed by `makeRateKey(date, base, target)`.
 * The wizard collects these on the confirm step and passes them to
 * `buildImportBatch` so cross-currency expenses are converted before
 * being sent to the server.
 */
export type ImportRatesByKey = Record<string, number>

export type ImportRateKeyItem = {
  date: string
  base: string
  target: string
}

/**
 * Compute the unique exchange-rate lookups required to import a set of
 * resolved expenses into a destination ledger. The wizard uses the
 * result to drive a single batched tRPC call to `currency.getRates`
 * before submitting. Items are deduplicated by `makeRateKey` and
 * returned in a stable order so the round trip is easy to test.
 *
 * Per-expense prior conversions are honored: an expense whose source
 * export already carried `originalCurrency` keeps that currency as the
 * effective base, even when the source group is in a different
 * currency. Items are only emitted when the effective base differs
 * from the destination ledger's currency.
 */
export function computeImportRateKeys(
  expenses: NormalizedSourceExpense[],
  sourceCurrencyCode: string,
  destinationCurrencyCode: string,
): ImportRateKeyItem[] {
  if (
    !sourceCurrencyCode ||
    !destinationCurrencyCode ||
    sourceCurrencyCode === destinationCurrencyCode
  ) {
    return []
  }

  const seen = new Set<string>()
  const items: ImportRateKeyItem[] = []
  for (const expense of expenses) {
    const base = (expense.originalCurrency ?? sourceCurrencyCode).toUpperCase()
    if (base === destinationCurrencyCode.toUpperCase()) continue
    const date = expense.expenseDate.slice(0, 10)
    const key = makeRateKey(date, base, destinationCurrencyCode)
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ date, base, target: destinationCurrencyCode.toUpperCase() })
  }
  return items
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
