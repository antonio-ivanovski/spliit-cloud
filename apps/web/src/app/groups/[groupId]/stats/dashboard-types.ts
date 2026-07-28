import type { CategoryId } from '@spliit/domain'

export type StatsDashboardData = {
  lifetimeTotal: number
  period: {
    from: Date
    to: Date
    granularity: 'DAY' | 'WEEK' | 'MONTH'
    total: number
    expenseCount: number
  } | null
  timeline: Array<
    | {
        type: 'bucket'
        start: Date
        categories: Array<{ categoryId: CategoryId; amount: number }>
        total: number
      }
    | { type: 'gap'; start: Date; end: Date }
  >
  categories: Array<{
    categoryId: CategoryId
    amount: number
    percentage: number
  }>
  participants: Array<{
    participantId: string
    name: string
    account: { id: string; name: string; image: string | null } | null
    amount: number
    percentage: number
  }>
}
export type StatsPeriod =
  | 'LATEST_ACTIVITY'
  | 'WEEK'
  | 'MONTH'
  | 'QUARTER'
  | 'YEAR'
  | 'CUSTOM'

export type StatsCustomRange = {
  from: string
  to: string
}
