import { z } from 'zod'

import { calculateShares, type TotalsExpense } from './totals'

export const budgetPeriodSchema = z.enum([
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
  'CUSTOM',
])
export type BudgetPeriod = z.infer<typeof budgetPeriodSchema>
export const budgetScopeModeSchema = z.enum(['ALL', 'SELECTED'])
export type BudgetScopeMode = z.infer<typeof budgetScopeModeSchema>

export type BudgetRule = {
  period: BudgetPeriod
  amount: number
  timeZone: string
  customStartDate?: Date | string | null
  customEndDate?: Date | string | null
  categoryScope: BudgetScopeMode
  categoryNodeIds: string[]
  participantScope: BudgetScopeMode
  participantIds: string[]
}

export type BudgetPeriodBounds = {
  start: Date
  end: Date
  days: number
  timeZone?: string
}

export type BudgetLifecycle = 'SCHEDULED' | 'ACTIVE' | 'COMPLETED'

function dateAtTimeZone(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(date)
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? ''
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    get('weekday'),
  )
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday,
  }
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

/** Calendar bounds are represented as UTC dates for stable SQL date comparisons. */
export function getBudgetPeriodBounds(
  rule: BudgetRule,
  at = new Date(),
): BudgetPeriodBounds {
  if (rule.period === 'CUSTOM') {
    if (!rule.customStartDate || !rule.customEndDate)
      throw new Error('Custom budgets require start and end dates')
    const start = new Date(rule.customStartDate)
    const end = new Date(rule.customEndDate)
    if (start > end) throw new Error('Custom budget start must be before end')
    const days =
      Math.floor(
        (Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) -
          Date.UTC(
            start.getUTCFullYear(),
            start.getUTCMonth(),
            start.getUTCDate(),
          )) /
          86400000,
      ) + 1
    return { start, end, days, timeZone: rule.timeZone }
  }
  const local = dateAtTimeZone(at, rule.timeZone)
  let start: Date
  if (rule.period === 'WEEKLY') {
    const mondayOffset = (local.weekday + 6) % 7
    start = utcDate(local.year, local.month, local.day - mondayOffset)
  } else if (rule.period === 'MONTHLY') {
    start = utcDate(local.year, local.month, 1)
  } else {
    start = utcDate(local.year, 1, 1)
  }
  const end =
    rule.period === 'WEEKLY'
      ? new Date(start.getTime() + 6 * 86400000)
      : rule.period === 'MONTHLY'
        ? utcDate(start.getUTCFullYear(), start.getUTCMonth() + 2, 0)
        : utcDate(start.getUTCFullYear() + 1, 1, 0)
  return {
    start,
    end,
    days: Math.floor((end.getTime() - start.getTime()) / 86400000) + 1,
    timeZone: rule.timeZone,
  }
}

export function getPreviousBudgetPeriodBounds(
  rule: BudgetRule,
  current: BudgetPeriodBounds,
): BudgetPeriodBounds | null {
  if (rule.period === 'CUSTOM') return null
  const anchor = new Date(current.start.getTime() - 86400000)
  return getBudgetPeriodBounds(rule, anchor)
}

export type BudgetExpense = TotalsExpense & {
  expenseDate?: Date | string | number | null
  categoryId?: string | null
}
export type BudgetUsageOptions = {
  categoryMatches?: (selectedNodeId: string, categoryId: string) => boolean
}

/**
 * Contribution of a single expense toward a budget period, in integer cents.
 *
 * Returns 0 when the expense is excluded: reimbursements and non-positive
 * amounts, dates outside the period bounds, categories outside a SELECTED
 * scope, and shares owed by participants outside a SELECTED scope. Otherwise it
 * sums the selected participants' calculated owed shares, reusing the shared
 * split calculation (even, shares, basis-point percentages, explicit amounts,
 * cross-currency, and itemized expenses).
 */
export function dateOnlyInBudgetZone(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const y = Number(get('year'))
  const m = Number(get('month'))
  const d = Number(get('day'))
  return new Date(Date.UTC(y, m - 1, d))
}

export function expenseDateInBudgetZone(
  expense: Pick<BudgetExpense, 'expenseDate'>,
  timeZone: string,
): Date | null {
  const rawDate = expense.expenseDate
  const instant = rawDate ? new Date(rawDate as Date | string | number) : null
  if (!instant || Number.isNaN(instant.getTime())) return null
  return dateOnlyInBudgetZone(instant, timeZone)
}

export function calculateExpenseContribution(
  rule: BudgetRule,
  expense: BudgetExpense,
  bounds: BudgetPeriodBounds,
  options: BudgetUsageOptions = {},
): number {
  if (expense.isReimbursement || expense.amount <= 0) return 0
  const date = expenseDateInBudgetZone(expense, rule.timeZone)
  if (!date || Number.isNaN(date.getTime())) return 0
  if (date < bounds.start || date > bounds.end) return 0
  const categoryId = expense.categoryId ?? null
  if (
    rule.categoryScope === 'SELECTED' &&
    (!categoryId ||
      !rule.categoryNodeIds.some(
        (node) =>
          options.categoryMatches?.(node, categoryId) ?? node === categoryId,
      ))
  )
    return 0
  const selectedParticipants =
    rule.participantScope === 'SELECTED' ? new Set(rule.participantIds) : null
  const shares = calculateShares(expense)
  return Object.entries(shares).reduce(
    (sum, [participantId, amount]) =>
      sum +
      (selectedParticipants && !selectedParticipants.has(participantId)
        ? 0
        : amount),
    0,
  )
}

/**
 * Calculates selected paid-for shares, excluding reimbursements and negative
 * amounts.
 */
export function calculateBudgetUsage(
  rule: BudgetRule,
  expenses: BudgetExpense[],
  bounds: BudgetPeriodBounds,
  options: BudgetUsageOptions = {},
): number {
  return expenses.reduce(
    (total, expense) =>
      total + calculateExpenseContribution(rule, expense, bounds, options),
    0,
  )
}

export function budgetTrend(
  usage: number,
  amount: number,
  bounds: BudgetPeriodBounds,
  at = new Date(),
): { projected: number; trending: boolean; over: boolean } {
  const local = dateAtTimeZone(at, bounds.timeZone ?? 'UTC')
  const localCalendarDate = utcDate(local.year, local.month, local.day)
  const elapsed = Math.max(
    0,
    Math.min(
      bounds.days,
      Math.floor(
        (localCalendarDate.getTime() - bounds.start.getTime()) / 86400000,
      ) + 1,
    ),
  )
  const projected =
    elapsed > 0 ? Math.round((usage * bounds.days) / elapsed) : 0
  return {
    projected,
    trending:
      elapsed / bounds.days >= 0.2 && projected > amount && usage <= amount,
    over: usage > amount,
  }
}

export function budgetDaysRemaining(
  bounds: BudgetPeriodBounds,
  at = new Date(),
): number {
  const local = dateAtTimeZone(at, bounds.timeZone ?? 'UTC')
  const localCalendarDate = utcDate(local.year, local.month, local.day)
  return Math.max(
    0,
    Math.ceil((bounds.end.getTime() - localCalendarDate.getTime()) / 86400000),
  )
}

/** Number of local calendar days until a custom period starts. */
export function budgetDaysUntilStart(
  bounds: BudgetPeriodBounds,
  at = new Date(),
): number {
  const local = dateAtTimeZone(at, bounds.timeZone ?? 'UTC')
  const localCalendarDate = utcDate(local.year, local.month, local.day)
  return Math.max(
    0,
    Math.ceil(
      (bounds.start.getTime() - localCalendarDate.getTime()) / 86400000,
    ),
  )
}

/**
 * Custom budgets have a useful lifecycle in addition to their spending trend.
 * Recurring budgets are always active because their bounds roll forward.
 */
export function getBudgetLifecycle(
  rule: Pick<BudgetRule, 'period'>,
  bounds: BudgetPeriodBounds,
  at = new Date(),
): BudgetLifecycle {
  if (rule.period !== 'CUSTOM') return 'ACTIVE'
  const today = budgetSpentCutoff(bounds, at)
  if (today < bounds.start) return 'SCHEDULED'
  if (today > bounds.end) return 'COMPLETED'
  return 'ACTIVE'
}

/**
 * Upper bound (inclusive, in UTC) for expenses that count as "spent so far" for
 * a budget, evaluated in the budget's timezone.
 *
 * Returns the UTC date for the local calendar day of `at` so that any
 * `expense.expenseDate <= cutoff` (treating expenseDate as midnight UTC for the
 * calendar day) counts as spent.
 */
export function budgetSpentCutoff(
  bounds: Pick<BudgetPeriodBounds, 'timeZone'>,
  at = new Date(),
): Date {
  const local = dateAtTimeZone(at, bounds.timeZone ?? 'UTC')
  return utcDate(local.year, local.month, local.day)
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

const CALENDAR_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function calendarParts(date: Date): {
  year: number
  month: number
  day: number
} {
  const parts = CALENDAR_PARTS.formatToParts(
    new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    ),
  )
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  }
}

function formatStartEnd(
  start: Date,
  end: Date,
  format: (date: Date) => string,
): string {
  const startText = format(start)
  const endText = format(end)
  return startText === endText ? startText : `${startText} – ${endText}`
}

function formatCalendar(date: Date): string {
  const parts = calendarParts(date)
  return `${pad2(parts.day)}.${pad2(parts.month)}.${parts.year}`
}

/**
 * Compact, locale-independent human range for a budget period.
 *
 * Calendar periods (WEEKLY/MONTHLY/YEARLY) always render both endpoints as
 * `dd.mm.yyyy` with a full four-digit year, e.g. `01.07.2026 – 31.07.2026`.
 * CUSTOM delegates to `formatFull`.
 *
 * `formatFull` only runs for CUSTOM periods, so domain callers that only use
 * calendar periods incur no locale handling.
 */
export function formatBudgetPeriodRange(
  period: BudgetPeriod,
  start: Date,
  end: Date,
  formatFull: (date: Date) => string,
): string {
  const format = period === 'CUSTOM' ? formatFull : formatCalendar
  return formatStartEnd(start, end, format)
}
