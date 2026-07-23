export const SplitMode = {
  EVENLY: 'EVENLY',
  BY_SHARES: 'BY_SHARES',
  BY_PERCENTAGE: 'BY_PERCENTAGE',
  BY_AMOUNT: 'BY_AMOUNT',
  ITEMIZED: 'ITEMIZED',
} as const

export type SplitMode = (typeof SplitMode)[keyof typeof SplitMode]

export const RecurrenceRule = {
  NONE: 'NONE',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY',
} as const

export type RecurrenceRule =
  (typeof RecurrenceRule)[keyof typeof RecurrenceRule]

/** The calendar unit used by an authoritative recurring-expense series. */
export const RecurrenceFrequency = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY',
} as const

export type RecurrenceFrequency =
  (typeof RecurrenceFrequency)[keyof typeof RecurrenceFrequency]

export const RecurringExpenseSeriesStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const

export type RecurringExpenseSeriesStatus =
  (typeof RecurringExpenseSeriesStatus)[keyof typeof RecurringExpenseSeriesStatus]
