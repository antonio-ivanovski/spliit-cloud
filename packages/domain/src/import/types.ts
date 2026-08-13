export type NormalizedSourceParticipant = {
  sourceId: string
  sourceName: string
}

import type { RecurrenceFrequency } from '../enums'
import type { RecurrenceConfig, RecurrenceEnd } from '../recurring-expenses'

export type { RecurrenceConfig, RecurrenceEnd, RecurrenceFrequency }

export type NormalizedSourceExpense = {
  /**
   * Stable upstream creation timestamp used only to recover spliit.app
   * documents.
   */
  sourceCreatedAt?: string | null
  title: string
  expenseDate: string
  category: string
  amountCurrency: string | null
  amount: number
  originalAmount: number | null
  originalCurrency: string | null
  conversionRate: number | null
  paidBySourceId: string
  paidBy: Array<{ sourceId: string; shares: number }>
  paidFor: Array<{ sourceId: string; shares: number }>
  splitMode: 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE' | 'BY_AMOUNT'
  /** Legacy alias retained for old import callers during the schema cutover. */
  recurrenceRule: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'
  recurrence?: RecurrenceConfig | null
  notes: string | null
}

export type NormalizedSource = {
  provider: 'SPLIIT' | 'SPLITWISE'
  sourceGroupId: string
  sourceUrl: string | null
  name: string
  currency: string
  currencyCode: string | null
  participants: NormalizedSourceParticipant[]
  expenses: NormalizedSourceExpense[]
}

export type ImportParseResult =
  | { ok: true; source: NormalizedSource }
  | { ok: false; error: string }
