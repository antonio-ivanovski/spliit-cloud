import type { AppRouterOutput } from '@spliit/api/router'
import type { CategoryId } from '@spliit/domain'

export type BudgetPeriodType = 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'CUSTOM'

export type BudgetScope = 'ALL' | 'SELECTED'

export type BudgetPeriod = {
  from: Date | string
  to: Date | string
  used: number
  limit: number
  remaining: number
  percentage: number
  projected: number | null
  trendStatus: 'ON_TRACK' | 'TRENDING_OVER' | 'OVER'
  lifecycle?: 'SCHEDULED' | 'ACTIVE' | 'COMPLETED'
  daysRemaining: number
  daysUntilStart?: number
  daysTotal?: number
  committed: number
  matchingExpensesTotal?: number
  upcomingExpensesTotal?: number
  daily?: Array<{ date: Date | string; spent: number; committed: number }>
}

export type BudgetMatchingExpense =
  AppRouterOutput['groups']['expenses']['list']['expenses'][number] & {
    contribution: number
  }

export type BudgetSummary = {
  id: string
  name: string
  amount: number
  periodType: BudgetPeriodType
  customStart: Date | string | null
  customEnd: Date | string | null
  categoryScope: BudgetScope
  categoryNodeIds: CategoryId[]
  participantScope: BudgetScope
  participantIds: string[]
  archived?: boolean
  archivedAt?: Date | string | null
  createdAt?: Date | string
  period: BudgetPeriod
}

export type BudgetDetail = BudgetSummary & {
  notifyTrending: boolean
  notifyOver: boolean
  history: Array<BudgetPeriod & { label?: string }>
  committed: number
  matchingExpenses: BudgetMatchingExpense[]
  upcomingExpenses: BudgetMatchingExpense[]
}

/** Normalizes the server DTO while the API evolves from `summary` to `period`. */
export function normalizeBudget(raw: Record<string, unknown>): BudgetSummary {
  const summary = (raw.period ?? raw.summary) as BudgetPeriod | undefined
  const summaryWithExpenses = summary as
    | (BudgetPeriod & {
        matchingExpenses?: unknown[]
        upcomingExpenses?: unknown[]
      })
    | undefined
  const period = summary
    ? {
        ...summary,
        lifecycle: summary.lifecycle ?? 'ACTIVE',
        daysUntilStart: summary.daysUntilStart ?? 0,
        matchingExpensesTotal:
          summary.matchingExpensesTotal ??
          summaryWithExpenses?.matchingExpenses?.length ??
          0,
        upcomingExpensesTotal:
          summary.upcomingExpensesTotal ??
          summaryWithExpenses?.upcomingExpenses?.length ??
          0,
        daily: summary.daily ?? [],
      }
    : undefined
  return {
    ...(raw as unknown as BudgetSummary),
    period: period ?? {
      from: new Date(),
      to: new Date(),
      used: 0,
      limit: Number(raw.amount ?? 0),
      remaining: Number(raw.amount ?? 0),
      percentage: 0,
      projected: null,
      trendStatus: 'ON_TRACK',
      lifecycle: 'ACTIVE',
      daysRemaining: 0,
      daysUntilStart: 0,
      committed: 0,
      matchingExpensesTotal: 0,
      upcomingExpensesTotal: 0,
      daily: [],
    },
  }
}

export function normalizeBudgetDetail(
  raw: Record<string, unknown>,
): BudgetDetail {
  const normalized = normalizeBudget(raw)
  const summary = (raw.period ?? raw.summary) as
    | (BudgetPeriod & {
        history?: BudgetDetail['history']
        matchingExpenses?: BudgetDetail['matchingExpenses']
        upcomingExpenses?: BudgetDetail['upcomingExpenses']
        committed?: number
      })
    | undefined
  return {
    ...normalized,
    notifyTrending: Boolean(raw.notifyTrending),
    notifyOver: Boolean(raw.notifyOver),
    history: summary?.history ?? [],
    matchingExpenses: summary?.matchingExpenses ?? [],
    upcomingExpenses: summary?.upcomingExpenses ?? [],
    committed: summary?.committed ?? 0,
  }
}

export type BudgetMutationInput = {
  groupId: string
  budgetId?: string
  name: string
  amount: number
  periodType: BudgetPeriodType
  customStart: string | null
  customEnd: string | null
  categoryScope: BudgetScope
  categoryNodeIds: CategoryId[]
  participantScope: BudgetScope
  participantIds: string[]
  notifyTrending: boolean
  notifyOver: boolean
}
