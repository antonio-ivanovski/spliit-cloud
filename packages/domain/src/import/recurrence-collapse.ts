import { calculateNextDate } from '../recurring-expenses'
import type { RecurrenceConfig } from './types'
import {
  legacyRuleToRecurrence,
  type LegacyRecurrenceRule,
} from './recurrence'

/** Minimal expense shape used to collapse legacy recurring rows into series. */
export type LegacyRecurringCollapseExpense = {
  title: string
  expenseDate: string | Date
  amount: number
  recurrenceRule: LegacyRecurrenceRule
  splitMode: string
  isReimbursement: boolean
  paidBy: Array<{ id: string; shares: number }>
  paidFor: Array<{ id: string; shares: number }>
  originalCurrency?: string | null
  conversionRate?: number | null
}

export type LegacyRecurringMembership = {
  expenseIndex: number
  seriesKey: string
  sequence: number
  isSeriesAnchor: boolean
}

export type LegacyRecurringSeriesPlan = {
  seriesKey: string
  title: string
  recurrenceRule: Exclude<LegacyRecurrenceRule, 'NONE'>
  config: RecurrenceConfig
  /** Index of the latest (anchor) expense in the input array. */
  anchorIndex: number
  occurrenceCount: number
  nextOccurrenceDate: Date
}

export type LegacyRecurringImportPlan = {
  membership: LegacyRecurringMembership[]
  series: LegacyRecurringSeriesPlan[]
}

export type LegacyRecurringSummaryItem = {
  title: string
  recurrenceRule: Exclude<LegacyRecurrenceRule, 'NONE'>
}

function toUtcDay(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(
      Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
      ),
    )
  }
  const iso = value.slice(0, 10)
  return new Date(`${iso}T00:00:00.000Z`)
}

function participantFingerprint(
  rows: Array<{ id: string; shares: number }>,
): string {
  return [...rows]
    .map((row) => `${row.id}:${row.shares}`)
    .sort()
    .join(',')
}

/** Conservative identity for collapsing historical occurrences of one schedule. */
export function fingerprintLegacyRecurringExpense(
  expense: LegacyRecurringCollapseExpense,
): string | null {
  if (expense.recurrenceRule === 'NONE') return null
  const currency = expense.originalCurrency ?? ''
  const rate =
    expense.conversionRate === null || expense.conversionRate === undefined
      ? ''
      : String(expense.conversionRate)
  return [
    expense.title,
    expense.recurrenceRule,
    String(expense.amount),
    expense.splitMode,
    expense.isReimbursement ? '1' : '0',
    participantFingerprint(expense.paidBy),
    participantFingerprint(expense.paidFor),
    currency,
    rate,
  ].join('\u001f')
}

/**
 * Advance from the day after the latest occurrence until the first date
 * strictly after `today` (UTC calendar day). Skips import catch-up backlogs.
 */
export function firstRecurrenceDateAfterToday(
  rule: Exclude<LegacyRecurrenceRule, 'NONE'>,
  latestExpenseDate: string | Date,
  today: Date = new Date(),
): Date {
  const todayDay = toUtcDay(today)
  let next = calculateNextDate(rule, toUtcDay(latestExpenseDate))
  while (next.getTime() <= todayDay.getTime()) {
    next = calculateNextDate(rule, next)
  }
  return next
}

/**
 * Group matching recurring rows into one series plan each. Non-recurring
 * expenses are omitted from membership.
 */
export function planLegacyRecurringImport(
  expenses: LegacyRecurringCollapseExpense[],
  today: Date = new Date(),
): LegacyRecurringImportPlan {
  const groups = new Map<string, number[]>()
  expenses.forEach((expense, index) => {
    const key = fingerprintLegacyRecurringExpense(expense)
    if (!key) return
    const list = groups.get(key) ?? []
    list.push(index)
    groups.set(key, list)
  })

  const membership: LegacyRecurringMembership[] = []
  const series: LegacyRecurringSeriesPlan[] = []

  for (const [seriesKey, indexes] of groups) {
    const ordered = [...indexes].sort((a, b) => {
      const da = toUtcDay(expenses[a].expenseDate).getTime()
      const db = toUtcDay(expenses[b].expenseDate).getTime()
      if (da !== db) return da - db
      return a - b
    })
    const anchorIndex = ordered[ordered.length - 1]!
    const anchor = expenses[anchorIndex]!
    const recurrenceRule = anchor.recurrenceRule
    if (recurrenceRule === 'NONE') continue
    const config = legacyRuleToRecurrence(recurrenceRule)
    if (!config) continue

    ordered.forEach((expenseIndex, offset) => {
      membership.push({
        expenseIndex,
        seriesKey,
        sequence: offset + 1,
        isSeriesAnchor: expenseIndex === anchorIndex,
      })
    })

    series.push({
      seriesKey,
      title: anchor.title,
      recurrenceRule,
      config,
      anchorIndex,
      occurrenceCount: ordered.length,
      nextOccurrenceDate: firstRecurrenceDateAfterToday(
        recurrenceRule,
        anchor.expenseDate,
        today,
      ),
    })
  }

  series.sort((a, b) => {
    const titleCmp = a.title.localeCompare(b.title)
    if (titleCmp !== 0) return titleCmp
    return a.recurrenceRule.localeCompare(b.recurrenceRule)
  })

  return { membership, series }
}

/** Unique collapsed schedules for import confirm UI (one row per series). */
export function summarizeLegacyRecurringImport(
  expenses: LegacyRecurringCollapseExpense[],
): LegacyRecurringSummaryItem[] {
  return planLegacyRecurringImport(expenses).series.map((plan) => ({
    title: plan.title,
    recurrenceRule: plan.recurrenceRule,
  }))
}

export function collapseExpenseFromNormalized(expense: {
  title: string
  expenseDate: string
  amount: number
  recurrenceRule: LegacyRecurrenceRule
  splitMode: string
  isReimbursement: boolean
  paidBySourceId?: string
  paidBy?: Array<{ sourceId: string; shares: number }>
  paidFor: Array<{ sourceId: string; shares: number }>
  originalCurrency?: string | null
  conversionRate?: number | null
}): LegacyRecurringCollapseExpense {
  const paidBy =
    expense.paidBy && expense.paidBy.length > 0
      ? expense.paidBy.map((row) => ({ id: row.sourceId, shares: row.shares }))
      : expense.paidBySourceId
        ? [{ id: expense.paidBySourceId, shares: expense.amount }]
        : []
  return {
    title: expense.title,
    expenseDate: expense.expenseDate,
    amount: expense.amount,
    recurrenceRule: expense.recurrenceRule,
    splitMode: expense.splitMode,
    isReimbursement: expense.isReimbursement,
    paidBy,
    paidFor: expense.paidFor.map((row) => ({
      id: row.sourceId,
      shares: row.shares,
    })),
    originalCurrency: expense.originalCurrency,
    conversionRate: expense.conversionRate,
  }
}

export function collapseExpenseFromApi(expense: {
  title: string
  expenseDate: string | Date
  amount: number
  recurrenceRule?: LegacyRecurrenceRule | null
  splitMode: string
  isReimbursement: boolean
  paidByList: Array<{ participant: string; shares: number }>
  paidFor: Array<{ participant: string; shares: number }>
  originalCurrency?: string | null
  conversionRate?: number | null
  conversion?: { currency?: string; rate?: number } | null
}): LegacyRecurringCollapseExpense {
  const originalCurrency =
    expense.originalCurrency ??
    (expense.conversion && 'currency' in expense.conversion
      ? expense.conversion.currency
      : null) ??
    null
  const conversionRate =
    expense.conversionRate ??
    (expense.conversion && 'rate' in expense.conversion
      ? expense.conversion.rate
      : null) ??
    null
  return {
    title: expense.title,
    expenseDate: expense.expenseDate,
    amount: expense.amount,
    recurrenceRule: expense.recurrenceRule ?? 'NONE',
    splitMode: expense.splitMode,
    isReimbursement: expense.isReimbursement,
    paidBy: expense.paidByList.map((row) => ({
      id: row.participant,
      shares: row.shares,
    })),
    paidFor: expense.paidFor.map((row) => ({
      id: row.participant,
      shares: row.shares,
    })),
    originalCurrency,
    conversionRate,
  }
}
