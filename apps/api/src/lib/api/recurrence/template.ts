import { RecurrenceEndType, RecurrenceFrequency } from '@spliit/db'
import {
  occurrenceDateToUtcRunAt,
  recurrenceConfigSchema,
  validateRecurrenceConfig,
  type RecurrenceConfig,
  type RecurringExpenseTemplate,
} from '@spliit/domain'

import { randomId } from '../shared'

/** Accept the new config and the legacy rule during the rollout window. */
export function getExpenseRecurrence(
  expense: {
    recurrence?: unknown
    recurrenceRule?: string | null
  },
  anchorDate?: Date,
): RecurrenceConfig | null {
  const value = (expense as { recurrence?: unknown }).recurrence
  if (value != null) {
    const parsed = recurrenceConfigSchema.safeParse(value)
    if (parsed.success) return validateRecurrenceConfig(parsed.data, anchorDate)
    throw new RangeError('Invalid recurrence configuration')
  }
  const rule = expense.recurrenceRule
  if (!rule || rule === 'NONE') return null
  if (!Object.values(RecurrenceFrequency).includes(rule as never)) {
    throw new RangeError(`Unsupported recurrence rule: ${rule}`)
  }
  return validateRecurrenceConfig(
    {
      frequency: rule as RecurrenceConfig['frequency'],
      interval: 1,
      end: { type: 'INDEFINITE' },
    },
    anchorDate,
  )
}

export function toSeriesFields(config: RecurrenceConfig) {
  return {
    frequency: config.frequency,
    interval: config.interval,
    endType: config.end.type,
    occurrenceLimit: config.end.type === 'COUNT' ? config.end.count : null,
    endDate: config.end.type === 'DATE' ? config.end.endDate : null,
  } as const
}

export function buildRecurringTemplate(args: {
  expense: {
    title: string
    category: string
    amount: number
    notes?: string
    paidBySplitMode: string
    paidByList: Array<{ participant: string; shares: number }>
    splitMode: string
    paidFor: Array<{ participant: string; shares: number }>
    paidForOverride?: Array<{ participant: string; shares: number }>
    items?: Array<{
      title: string
      unitPrice: number
      quantity: number
      amount: number
      splitMode: string
      paidFor: Array<{ participant: string; shares: number }>
    }>
    itemizedRemainder?: {
      splitMode: string
      paidFor: Array<{ participant: string; shares: number }>
    }
  }
  conversion: {
    ledgerAmountMinor: number
    originalAmount: number | null
    originalCurrency: string | null
    conversionRate: number | null
    conversionSource: 'EXCHANGE' | 'CUSTOM' | null
  }
}): RecurringExpenseTemplate {
  const { expense, conversion } = args
  return {
    title: expense.title,
    categoryId: expense.category,
    // Keep entered-currency units so EXCHANGE can be resolved again per date.
    amount: conversion.originalAmount ?? expense.amount,
    originalAmount: conversion.originalAmount,
    originalCurrency: conversion.originalCurrency,
    conversionRate: conversion.conversionRate,
    conversionSource: conversion.conversionSource,
    paidBySplitMode: expense.paidBySplitMode,
    paidByList: expense.paidByList.map((p) => ({
      ledgerParticipantId: p.participant,
      shares: p.shares,
    })),
    paidFor: (expense.paidForOverride ?? expense.paidFor).map((p) => ({
      ledgerParticipantId: p.participant,
      shares: p.shares,
    })),
    splitMode: expense.splitMode,
    notes: expense.notes ?? null,
    items: (expense.items ?? []).map((item) => ({
      title: item.title,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      amount: item.amount,
      splitMode: item.splitMode,
      paidFor: item.paidFor.map((p) => ({
        ledgerParticipantId: p.participant,
        shares: p.shares,
      })),
    })),
    itemizedRemainder: expense.itemizedRemainder
      ? {
          splitMode: expense.itemizedRemainder.splitMode,
          paidFor: expense.itemizedRemainder.paidFor.map((p) => ({
            ledgerParticipantId: p.participant,
            shares: p.shares,
          })),
        }
      : null,
  }
}

export function endReached(
  series: {
    endType: RecurrenceEndType
    occurrenceLimit: number | null
    endDate: Date | null
  },
  sequence: number,
  date: Date,
) {
  return (
    (series.endType === RecurrenceEndType.COUNT &&
      series.occurrenceLimit !== null &&
      sequence >= series.occurrenceLimit) ||
    (series.endType === RecurrenceEndType.DATE &&
      series.endDate !== null &&
      date.getTime() >= series.endDate.getTime())
  )
}

export function initialSeriesCompleted(
  fields: {
    endType: RecurrenceEndType
    occurrenceLimit: number | null
    endDate: Date | null
  },
  anchorDate: Date,
  nextDate: Date,
) {
  return (
    endReached(fields, 1, anchorDate) ||
    (fields.endType === RecurrenceEndType.DATE &&
      fields.endDate !== null &&
      nextDate > fields.endDate)
  )
}

export function recurrenceJobStartAfter(
  date: Date,
  timeZone: string,
  timeMinutes: number,
  now?: Date,
): Date | undefined {
  const executionDate = occurrenceDateToUtcRunAt(date, timeZone, timeMinutes)
  return executionDate.getTime() <= (now ?? new Date()).getTime()
    ? undefined
    : executionDate
}

export function occurrenceExpenseData(
  template: RecurringExpenseTemplate,
  date: Date,
  id: string,
  seriesId: string,
  sequence: number,
  amount: number,
  conversion:
    | {
        conversionRate: number | null
        originalAmount: number | null
        originalCurrency: string | null
        conversionSource: 'EXCHANGE' | 'CUSTOM' | null
      }
    | undefined,
  opts: { expenseDate: Date; expenseTimeZone: string },
) {
  return {
    id,
    expenseDate: opts.expenseDate,
    expenseTimeZone: opts.expenseTimeZone,
    recurringSeriesId: seriesId,
    recurrenceSequence: sequence,
    categoryId: template.categoryId,
    amount,
    originalAmount: conversion?.originalAmount ?? template.originalAmount,
    originalCurrency: conversion?.originalCurrency ?? template.originalCurrency,
    conversionRate: conversion?.conversionRate ?? template.conversionRate,
    conversionSource: conversion?.conversionSource ?? template.conversionSource,
    title: template.title,
    paidBySplitMode: template.paidBySplitMode as never,
    splitMode: template.splitMode as never,
    notes: template.notes,
    paidByList: { createMany: { data: template.paidByList } },
    paidFor: { createMany: { data: template.paidFor } },
    items: {
      create: template.items.map((item) => ({
        id: randomId(),
        title: item.title,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        amount: item.amount,
        splitMode: item.splitMode as never,
        paidFor: { createMany: { data: item.paidFor } },
      })),
    },
    ...(template.itemizedRemainder
      ? {
          itemizedRemainder: {
            create: {
              splitMode: template.itemizedRemainder.splitMode as never,
              paidFor: {
                createMany: { data: template.itemizedRemainder.paidFor },
              },
            },
          },
        }
      : {}),
  }
}

export function toRecurrenceConfig(series: {
  frequency: RecurrenceFrequency
  interval: number
  endType: RecurrenceEndType
  occurrenceLimit: number | null
  endDate: Date | null
}): RecurrenceConfig {
  return {
    frequency: series.frequency,
    interval: series.interval,
    end:
      series.endType === 'COUNT'
        ? { type: 'COUNT', count: series.occurrenceLimit ?? 1 }
        : series.endType === 'DATE'
          ? { type: 'DATE', endDate: series.endDate ?? new Date() }
          : { type: 'INDEFINITE' },
  }
}
