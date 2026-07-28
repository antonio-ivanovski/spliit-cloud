import type { ExpenseConversionInput } from '../conversion'
import type { Currency } from '../currency'
import { getCurrency } from '../currency'
import { distributeRemainder } from '../remainder-distribution'
import { calculateExactShares, serializePaidBy } from '../totals'
import type { ParticipantMappingState } from './matching'
import type {
  NormalizedSource,
  NormalizedSourceExpense,
  RecurrenceConfig,
} from './types'

export type ImportConversionMode = 'perDate' | 'fixed'

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
  /**
   * Optional wizard conversion modes keyed by `BASE|TARGET` (e.g. `EUR|USD`).
   * `perDate` → EXCHANGE, `fixed` → CUSTOM (locked rate, API or override).
   */
  conversionModes?: Record<string, ImportConversionMode>
}

/** Cache key for an exchange rate lookup. */
export function makeRateKey(
  date: string,
  base: string,
  target: string,
): string {
  return `${date}|${base.toUpperCase()}|${target.toUpperCase()}`
}

/** Pre-fetched exchange rates keyed by `makeRateKey(date, base, target)`. */
export type ImportRatesByKey = Record<string, number>

export type ImportRateKeyItem = {
  date: string
  base: string
  target: string
}

/**
 * Resolve the expense-currency amount to import from a normalized expense.
 *
 * After Spliit parse, `amount`/`originalAmount` are already recovered expense
 * money (ledger÷rate). This only picks which fields to use — no second recovery
 * and no caching.
 */
export function resolveImportExpenseMoney(
  e: Pick<
    NormalizedSourceExpense,
    'amount' | 'amountCurrency' | 'originalAmount' | 'originalCurrency'
  >,
  sourceCurrencyCode: string,
): {
  expenseCurrency: string
  expenseAmount: number
} {
  const usesOriginalCurrency =
    e.originalCurrency != null &&
    e.originalCurrency !== '' &&
    e.originalAmount != null

  const expenseCurrency = usesOriginalCurrency
    ? e.originalCurrency!
    : (e.amountCurrency ?? sourceCurrencyCode)

  const expenseAmount = usesOriginalCurrency ? e.originalAmount! : e.amount

  return { expenseCurrency, expenseAmount }
}

/**
 * Compute the unique exchange-rate lookups required to import a set of resolved
 * expenses into a destination ledger.
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
    const { expenseCurrency } = resolveImportExpenseMoney(
      expense,
      sourceCurrencyCode,
    )
    const base = expenseCurrency.toUpperCase()
    if (!base || base === destination) continue
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
  | {
      mode: 'INVITE_CONTACT'
      sourceName: string
      email: string
      destLedgerParticipantId: string
    }

export type ImportBatchExpense = {
  expenseDate: Date
  title: string
  category: never
  amount: number
  /** Present only when expense currency differs from the destination. */
  conversion?: ExpenseConversionInput
  paidByList: Array<{ participant: string; shares: number }>
  paidBySplitMode: 'BY_AMOUNT'
  paidFor: Array<{ participant: string; shares: number }>
  splitMode: 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE' | 'BY_AMOUNT'
  isReimbursement: boolean
  documents: never[]
  notes: string | undefined
  /** Internal mapping of the legacy recurrence rule. */
  recurrence: RecurrenceConfig | null
  /** Legacy alias kept until all import API callers consume recurrence. */
  recurrenceRule: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'
}

/**
 * Map wizard conversion mode for a currency pair to a conversion discriminant.
 * Missing mode defaults to exchange (historical rates from the provider).
 */
export function importConversionForPair(
  amountCurrency: string,
  destinationCurrencyCode: string,
  rate: number | undefined,
  conversionModes?: Record<string, ImportConversionMode>,
): ExpenseConversionInput {
  if (!conversionModes) {
    return { type: 'exchange', currency: amountCurrency }
  }
  const pairKey = `${amountCurrency}|${destinationCurrencyCode}`
  const upperKey = `${amountCurrency.toUpperCase()}|${destinationCurrencyCode.toUpperCase()}`
  const mode = conversionModes[pairKey] ?? conversionModes[upperKey]
  if (mode === 'fixed') {
    // Propagate invalid/missing rates so server RATE_NOT_POSITIVE rejects the
    // batch instead of silently converting at 1:1.
    return {
      type: 'custom',
      currency: amountCurrency,
      rate: typeof rate === 'number' ? rate : 0,
    }
  }
  return { type: 'exchange', currency: amountCurrency }
}

/** @deprecated use importConversionForPair */
export function importConversionSourceForPair(
  amountCurrency: string,
  destinationCurrencyCode: string,
  conversionModes?: Record<string, ImportConversionMode>,
): 'EXCHANGE' | 'CUSTOM' {
  const c = importConversionForPair(
    amountCurrency,
    destinationCurrencyCode,
    undefined,
    conversionModes,
  )
  return c.type === 'custom' ? 'CUSTOM' : 'EXCHANGE'
}

const FALLBACK_CURRENCY: Currency = {
  code: '',
  symbol: '',
  rounding: 0,
  decimal_digits: 2,
}

function currencyOrFallback(code: string | null | undefined): Currency {
  if (!code) return FALLBACK_CURRENCY
  return getCurrency(code) ?? { ...FALLBACK_CURRENCY, code, symbol: code }
}

/** PaidBy stays in expense currency minor units. */
function normalizePaidByOriginal(
  paidByList: Array<{ participant: string; shares: number }>,
  originalCurrency: Currency,
  targetOriginalAmount: number,
): Array<{ participant: string; shares: number }> {
  const scale = 10 ** originalCurrency.decimal_digits
  const serialized = serializePaidBy({
    paidBySplitMode: 'BY_AMOUNT',
    amount: targetOriginalAmount,
    inputCurrency: originalCurrency,
    paidByList: paidByList.map((p) => ({
      participant: { id: p.participant },
      shares: p.shares / scale,
    })),
  })
  const exact = calculateExactShares({
    amount: targetOriginalAmount,
    splitMode: 'BY_AMOUNT',
    participants: serialized.map((p) => ({
      id: p.participant.id,
      shares: p.shares,
    })),
  })
  const fixed = distributeRemainder(exact, targetOriginalAmount, {
    payerId: serialized[0]?.participant.id,
  })
  return Object.entries(fixed).map(([participant, shares]) => ({
    participant,
    shares,
  }))
}

/**
 * Scale BY_AMOUNT paidFor shares so they sum to `targetAmount`. Converted
 * Spliit sources often store paidFor in ledger units while the import amount is
 * the original-currency expense amount.
 */
function normalizePaidForByAmount(
  paidFor: Array<{ participant: string; shares: number }>,
  targetAmount: number,
): Array<{ participant: string; shares: number }> {
  if (paidFor.length === 0) return paidFor
  const sum = paidFor.reduce((s, p) => s + p.shares, 0)
  if (sum === targetAmount) {
    return paidFor.map((p) => ({
      participant: p.participant,
      shares: Math.round(p.shares),
    }))
  }
  if (sum === 0) {
    return paidFor.map((p, i) => ({
      participant: p.participant,
      shares: i === 0 ? targetAmount : 0,
    }))
  }
  const exact: Record<string, { numerator: bigint; denominator: bigint }> = {}
  for (const p of paidFor) {
    exact[p.participant] = {
      numerator: BigInt(p.shares) * BigInt(targetAmount),
      denominator: BigInt(sum),
    }
  }
  const reconciled = distributeRemainder(exact, targetAmount, {
    payerId: paidFor[0]?.participant,
  })
  return paidFor.map((p) => ({
    participant: p.participant,
    shares: reconciled[p.participant] ?? 0,
  }))
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
    if (p.mode === 'INVITE_BY_EMAIL' || p.mode === 'INVITE_CONTACT') {
      if (!p.inviteEmail?.trim()) {
        throw new Error(`Missing email for invitee "${p.source.sourceName}"`)
      }
      return {
        mode: p.mode as 'INVITE_BY_EMAIL' | 'INVITE_CONTACT',
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
    const { expenseCurrency, expenseAmount } = resolveImportExpenseMoney(
      e,
      sourceCurrencyCode,
    )

    const normalizedPaidBy =
      e.paidBy.length > 0
        ? e.paidBy
        : [{ sourceId: e.paidBySourceId, shares: expenseAmount }]
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

    const expenseCurrencyObj = currencyOrFallback(expenseCurrency)
    const inputPaidBy = normalizePaidByOriginal(
      paidByList,
      expenseCurrencyObj,
      expenseAmount,
    )
    let inputPaidFor = paidFor.map((p) => ({
      participant: p.participant,
      shares: Math.round(p.shares),
    }))
    if (e.splitMode === 'BY_AMOUNT') {
      inputPaidFor = normalizePaidForByAmount(inputPaidFor, expenseAmount)
    }

    const destUpper = destinationCurrencyCode.toUpperCase()
    const expenseUpper = expenseCurrency.toUpperCase()
    const needsConversion =
      !!destinationCurrencyCode &&
      !!expenseCurrency &&
      expenseUpper !== destUpper

    if (needsConversion) {
      const dateKey = e.expenseDate.slice(0, 10)
      if (!rates) {
        throw new Error(
          `Cannot import "${e.title}": cross-currency conversion needs an exchange rate from ${expenseCurrency} to ${destinationCurrencyCode}.`,
        )
      }
      const rateKey = makeRateKey(
        dateKey,
        expenseCurrency,
        destinationCurrencyCode,
      )
      const rate = rates[rateKey]
      if (typeof rate !== 'number') {
        throw new Error(
          `Cannot import "${e.title}": missing exchange rate for ${expenseCurrency} -> ${destinationCurrencyCode} on ${dateKey}.`,
        )
      }

      return {
        expenseDate: new Date(e.expenseDate),
        title: e.title,
        category: e.category as never,
        amount: expenseAmount,
        conversion: importConversionForPair(
          expenseCurrency,
          destinationCurrencyCode,
          rate,
          state.conversionModes,
        ),
        paidByList: inputPaidBy,
        paidBySplitMode: 'BY_AMOUNT',
        paidFor: inputPaidFor,
        splitMode: e.splitMode,
        isReimbursement: e.isReimbursement,
        documents: [],
        notes: e.notes ?? undefined,
        recurrence: e.recurrence ?? null,
        recurrenceRule: e.recurrenceRule,
      }
    }

    return {
      expenseDate: new Date(e.expenseDate),
      title: e.title,
      category: e.category as never,
      amount: expenseAmount,
      paidByList: inputPaidBy,
      paidBySplitMode: 'BY_AMOUNT',
      paidFor: inputPaidFor,
      splitMode: e.splitMode,
      isReimbursement: e.isReimbursement,
      documents: [],
      notes: e.notes ?? undefined,
      recurrence: e.recurrence ?? null,
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
