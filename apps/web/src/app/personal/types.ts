import type { CategoryId } from '@spliit/domain'

/**
 * Personal expenses DTOs. These mirror the `personal.*` tRPC contract from
 * `handoff/personal-expenses-implementation.md`. The API router is being built
 * in parallel, so the web keeps its own copy here and switches to
 * `AppRouterOutput['personal']` once the procedures land (see `api.ts`).
 */

export type PersonalEntryKind = 'EXPENSE' | 'INCOME'
export type PersonalEntrySource = 'PERSONAL' | 'GROUP'

export type PersonalAttachment = {
  id: string
  url: string
  fileName: string | null
  contentType: string | null
  width: number | null
  height: number | null
  createdAt: string
}

export type PersonalEntry = {
  id: string
  kind: PersonalEntryKind
  /** Positive minor units in `currencyCode`; `kind` carries the sign. */
  amount: number
  currencyCode: string
  originalAmount: number | null
  originalCurrency: string | null
  /** Calendar date `YYYY-MM-DD` in the profile time zone. */
  date: string
  categoryId: string
  title: string | null
  note: string | null
  version: number
  source: PersonalEntrySource
  group: { id: string; name: string } | null
  canEdit: boolean
  attachments: PersonalAttachment[]
  recurring: { seriesId: string; sequence: number } | null
}

export type PersonalRecurringSeries = {
  id: string
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  anchorDate: string
  nextOccurrenceDate: string
  nextOccurrenceOrdinal: number
  endType: 'INDEFINITE' | 'COUNT' | 'DATE'
  occurrenceLimit: number | null
  endDate: string | null
  occurrencesCreated: number
  generatedCount: number
  kind: PersonalEntryKind
  amount: number
  currencyCode: string
  categoryId: string
  title: string | null
  note: string | null
  version: number
  timeZone: string
}

export type PersonalRecurringUpcoming = {
  seriesId: string
  sequence: number
  date: string
  overdue: boolean
  kind: PersonalEntryKind
  amount: number
  currencyCode: string
  categoryId: string
  title: string | null
}

export type PersonalBudgetState = 'OK' | 'TRENDING' | 'OVER'

export type PersonalBudget = {
  id: string
  name: string
  amount: number
  currencyCode: string
  period?: 'MONTHLY'
  categoryScope: 'ALL' | 'SELECTED'
  categoryIds: string[]
  startDay?: number
  archived?: boolean
  spent: number
  remaining: number
  ratio: number
  projected: number
  state: PersonalBudgetState
}

export type PersonalOverviewSharedGroup = {
  groupId: string
  name: string
  count: number
  amount: number
}

export type PersonalOverview = {
  month: string
  currencyCode: string
  spent: number
  income: number
  net: number
  previousSpent: number
  /** Month-over-month delta in minor units (positive = spent more). */
  delta: number
  categories: Array<{ categoryId: string; amount: number; percentage: number }>
  recent: PersonalEntry[]
  budgets: PersonalBudget[]
  overallBudget: PersonalBudget | null
  shared: {
    enabled: boolean
    count: number
    amount: number
    groups: PersonalOverviewSharedGroup[]
  }
}

export type PersonalProfile = {
  currencyCode: string
  timeZone: string
  sharedEnabled: boolean
  hasData?: boolean
  canChangeCurrency?: boolean
}

export type PersonalSourceGroup = {
  groupId: string
  name: string
  included: boolean
  /** `YYYY-MM-DD` or null (all history). */
  includeFrom: string | null
  memberCount: number
  expenseCount: number
}

export type PersonalSources = {
  profile: PersonalProfile
  groups: PersonalSourceGroup[]
}

export type PersonalEntryFilter = {
  month?: string
  from?: string
  to?: string
  q?: string
  categoryIds?: string[]
  kinds?: PersonalEntryKind[]
  source?: 'ALL' | PersonalEntrySource
  minAmount?: number
  maxAmount?: number
  limit?: number
  cursor?: string
}

export type PersonalTransactionsResult = {
  entries: PersonalEntry[]
  nextCursor: string | null
  totals: { spent: number; income: number; count: number }
}

export type PersonalEntryInput = {
  kind: PersonalEntryKind
  /** Positive minor units. */
  amount: number
  currencyCode?: string
  date: string
  categoryId: CategoryId
  title?: string
  note?: string
}

export function isSharedEntry(entry: PersonalEntry): boolean {
  return entry.source === 'GROUP'
}

export function entryAbsAmount(entry: PersonalEntry): number {
  return Math.abs(entry.amount)
}
