import type { ParticipantMappingState } from './matching'
import type { NormalizedSource, NormalizedSourceExpense } from './types'

export type ImportBatchState = {
  source:
    (Pick<NormalizedSource, 'currencyCode'> & Record<string, unknown>) | null
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
  if (!destinationCurrencyCode) return []

  const seen = new Set<string>()
  const items: ImportRateKeyItem[] = []
  for (const expense of expenses) {
    const destination = destinationCurrencyCode.toUpperCase()
    const amountCurrency = (
      expense.amountCurrency ?? sourceCurrencyCode
    ).toUpperCase()
    if (!amountCurrency || amountCurrency === destination) continue
    if (
      expense.originalCurrency?.toUpperCase() === destination &&
      expense.originalAmount !== null
    ) {
      continue
    }
    const base = amountCurrency
    const date = expense.expenseDate.slice(0, 10)
    const key = makeRateKey(date, base, destination)
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ date, base, target: destination })
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
  paidByList: Array<{ participant: string; shares: number }>
  paidBySplitMode: 'BY_AMOUNT'
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

  const expenses: ImportBatchExpense[] = state.resolvedExpenses.map((e) => {
    const normalizedPaidBy =
      e.paidBy.length > 0
        ? e.paidBy
        : [{ sourceId: e.paidBySourceId, shares: e.originalAmount ?? e.amount }]
    const paidByList: Array<{ participant: string; shares: number }> = []
    for (const p of normalizedPaidBy) {
      const destId = state.sourceIdToDestId[p.sourceId]
      if (!destId) {
        throw new Error(
          `Missing destination id for paidBy participant ${p.sourceId}`,
        )
      }
      paidByList.push({ participant: destId, shares: p.shares })
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

    const amountCurrency = e.amountCurrency ?? sourceCurrencyCode
    const effectiveOriginalCurrency = e.originalCurrency ?? amountCurrency
    const effectiveOriginalAmount = e.originalAmount ?? e.amount
    const needsConversion =
      !!destinationCurrencyCode &&
      !!amountCurrency &&
      amountCurrency !== destinationCurrencyCode

    if (needsConversion) {
      const dateKey = e.expenseDate.slice(0, 10)
      let convertedAmount: number
      let shareRate: number

      if (
        e.originalCurrency?.toUpperCase() ===
          destinationCurrencyCode.toUpperCase() &&
        e.originalAmount !== null
      ) {
        convertedAmount = e.originalAmount
        shareRate = convertedAmount / e.amount
      } else {
        if (!rates) {
          throw new Error(
            `Cannot import "${e.title}": cross-currency conversion needs an exchange rate from ${amountCurrency} to ${destinationCurrencyCode}.`,
          )
        }
        const rateKey = makeRateKey(
          dateKey,
          amountCurrency,
          destinationCurrencyCode,
        )
        const rate = rates[rateKey]
        if (typeof rate !== 'number') {
          throw new Error(
            `Cannot import "${e.title}": missing exchange rate for ${amountCurrency} -> ${destinationCurrencyCode} on ${dateKey}.`,
          )
        }
        convertedAmount = Math.round(e.amount * rate)
        shareRate = rate
      }

      const convertedPaidFor =
        e.splitMode === 'BY_AMOUNT'
          ? paidFor.map((p) => ({
              participant: p.participant,
              shares: Math.round(p.shares * shareRate),
            }))
          : paidFor
      if (e.splitMode === 'BY_AMOUNT') {
        const sumConverted = convertedPaidFor.reduce((s, p) => s + p.shares, 0)
        const drift = convertedAmount - sumConverted
        if (drift !== 0 && convertedPaidFor.length > 0) {
          let largestIdx = 0
          for (let i = 1; i < convertedPaidFor.length; i++) {
            if (
              convertedPaidFor[i].shares > convertedPaidFor[largestIdx].shares
            )
              largestIdx = i
          }
          convertedPaidFor[largestIdx].shares += drift
        }
      }

      const convertedPaidBy =
        e.originalCurrency && e.originalAmount !== null
          ? paidByList.length === 1
            ? [{ ...paidByList[0], shares: e.originalAmount }]
            : paidByList.map((p) => ({
                participant: p.participant,
                shares: Math.round(p.shares),
              }))
          : paidByList.map((p) => ({
              participant: p.participant,
              shares: Math.round(p.shares),
            }))
      const paidByTarget = effectiveOriginalAmount
      const paidBySum = convertedPaidBy.reduce((s, p) => s + p.shares, 0)
      const paidByDrift = paidByTarget - paidBySum
      if (paidByDrift !== 0 && convertedPaidBy.length > 0) {
        let largestIdx = 0
        for (let i = 1; i < convertedPaidBy.length; i++) {
          if (convertedPaidBy[i].shares > convertedPaidBy[largestIdx].shares)
            largestIdx = i
        }
        convertedPaidBy[largestIdx].shares += paidByDrift
      }

      const conversionRate =
        effectiveOriginalAmount !== 0
          ? convertedAmount / effectiveOriginalAmount
          : undefined

      return {
        expenseDate: new Date(e.expenseDate),
        title: e.title,
        category: e.category as never,
        amount: convertedAmount,
        originalAmount: effectiveOriginalAmount,
        originalCurrency: effectiveOriginalCurrency,
        conversionRate,
        paidByList: convertedPaidBy,
        paidBySplitMode: 'BY_AMOUNT',
        paidFor: convertedPaidFor,
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
      paidByList,
      paidBySplitMode: 'BY_AMOUNT',
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
