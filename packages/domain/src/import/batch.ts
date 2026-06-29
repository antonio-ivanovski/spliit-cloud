import type { ParticipantMappingState } from './matching'
import type { NormalizedSource, NormalizedSourceExpense } from './types'

export type ImportBatchState = {
  source:
    | (Pick<NormalizedSource, 'currencyCode'> & Record<string, unknown>)
    | null
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

/**
 * Cache key for an exchange rate lookup.
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
 */
export type ImportRatesByKey = Record<string, number>

export type ImportRateKeyItem = {
  date: string
  base: string
  target: string
}

/**
 * Compute the unique exchange-rate lookups required to import a set of
 * resolved expenses into a destination ledger.
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
