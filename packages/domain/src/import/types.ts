export type NormalizedSourceParticipant = {
  sourceId: string
  sourceName: string
}

export type NormalizedSourceExpense = {
  title: string
  expenseDate: string
  category: string
  amount: number
  originalAmount: number | null
  originalCurrency: string | null
  conversionRate: number | null
  paidBySourceId: string
  paidFor: Array<{ sourceId: string; shares: number }>
  splitMode: 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE' | 'BY_AMOUNT'
  recurrenceRule: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'
  isReimbursement: boolean
  notes: string | null
}

export type NormalizedSource = {
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
