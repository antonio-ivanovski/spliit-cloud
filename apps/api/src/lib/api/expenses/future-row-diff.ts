import type { Prisma } from '@spliit/db'
import { conversionFromStored, type Expense } from '@spliit/domain'

import type { buildRecurringTemplate } from '../recurrence-series'
import { toRecurrenceConfig } from '../recurrence-series'
import {
  expenseItemWithSharesSelect,
  expenseItemizedRemainderSelect,
} from '../selects/expense-item-with-shares'
import { expenseParticipantSharesSelect } from '../selects/expense-participant-shares'

// Narrow future-row snapshot select reused inside the THIS_AND_FUTURE update
// transaction. Keep it tight: full per-row state needed to diff future
// occurrences against the new series template.
export const futureRowSnapshotSelect = {
  id: true,
  title: true,
  amount: true,
  expenseDate: true,
  expenseTimeZone: true,
  categoryId: true,
  notes: true,
  isReimbursement: true,
  splitMode: true,
  paidBySplitMode: true,
  originalAmount: true,
  originalCurrency: true,
  conversionRate: true,
  conversionSource: true,
  paidByList: { select: expenseParticipantSharesSelect },
  paidFor: { select: expenseParticipantSharesSelect },
  items: { select: expenseItemWithSharesSelect },
  itemizedRemainder: { select: expenseItemizedRemainderSelect },
  documents: {
    select: {
      id: true,
      url: true,
      fileName: true,
      contentType: true,
      width: true,
      height: true,
    },
  },
} satisfies Prisma.ExpenseSelect

export type FutureRowSnapshot = Prisma.ExpenseGetPayload<{
  select: typeof futureRowSnapshotSelect
}>

export type RecurrenceShape = {
  recurrence: Expense['recurrence']
  recurrenceRule: Expense['recurrenceRule']
}

/**
 * Recurrence identity is shared between before/after shapes for a future row:
 * series recurrence is per-series, not per-row, so it cancels in the diff.
 */
export function sharedRecurrenceFromSeries(
  series: {
    frequency: string
    interval: number
    endType: string
    occurrenceLimit: number | null
    endDate: Date | null
  } | null,
): RecurrenceShape {
  if (!series) return { recurrence: null, recurrenceRule: 'NONE' }
  return {
    recurrence: toRecurrenceConfig(series as never),
    recurrenceRule: (series.frequency ?? 'NONE') as Expense['recurrenceRule'],
  }
}

/**
 * Map a snapshot row to the BEFORE shape used by activity diffs. Recurrence is
 * supplied separately so before/after use the same identity. Item ids are
 * dropped on BOTH sides: template propagation recreates items wholesale, so
 * ephemeral DB ids would otherwise fake an all-items diff.
 */
export function futureRowBeforeShape(
  row: FutureRowSnapshot,
  shared: RecurrenceShape,
): Expense & {
  originalAmount?: number
  originalCurrency?: string
  conversionRate?: number
  conversionSource?: 'EXCHANGE' | 'CUSTOM' | null
} {
  return {
    title: row.title,
    amount: row.amount,
    expenseDate: row.expenseDate,
    expenseTimeZone: row.expenseTimeZone,
    category: row.categoryId as Expense['category'],
    notes: row.notes ?? undefined,
    recurrenceRule: shared.recurrenceRule,
    recurrence: shared.recurrence,
    splitMode: row.splitMode,
    paidBySplitMode: row.paidBySplitMode,
    paidByList: row.paidByList.map((pb) => ({
      participant: pb.ledgerParticipantId,
      shares: pb.shares,
    })),
    paidFor: row.paidFor.map((pf) => ({
      participant: pf.ledgerParticipantId,
      shares: pf.shares,
    })),
    items: (row.items ?? []).map((item) => ({
      title: item.title,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      amount: item.amount,
      splitMode: item.splitMode,
      paidFor: item.paidFor.map((pf) => ({
        participant: pf.ledgerParticipantId,
        shares: pf.shares,
      })),
    })),
    itemizedRemainder: row.itemizedRemainder
      ? {
          splitMode: row.itemizedRemainder.splitMode,
          paidFor: row.itemizedRemainder.paidFor.map((pf) => ({
            participant: pf.ledgerParticipantId,
            shares: pf.shares,
          })),
        }
      : undefined,
    documents: row.documents.map((d) => ({
      id: d.id,
      url: d.url,
      fileName: d.fileName,
      contentType: d.contentType,
      width: d.width,
      height: d.height,
    })),
    conversion: conversionFromStored({
      conversionSource: row.conversionSource,
      originalCurrency: row.originalCurrency,
      conversionRate: row.conversionRate,
    }),
    originalAmount: row.originalAmount ?? undefined,
    originalCurrency: row.originalCurrency ?? undefined,
    conversionRate: row.conversionRate ?? undefined,
    conversionSource: row.conversionSource,
    isReimbursement: row.isReimbursement,
  } as Expense & {
    originalAmount?: number
    originalCurrency?: string
    conversionRate?: number
    conversionSource?: 'EXCHANGE' | 'CUSTOM' | null
  }
}

/**
 * Build the AFTER shape from the new template + this row's resolved conversion.
 * The row's `documents` and the shared series recurrence identity are passed
 * through unchanged (no per-row document or recurrence diff). Pass
 * `expenseDate` and `expenseTimeZone` when a schedule reflow or timing edit
 * moves the row.
 */
export function futureRowAfterShape(args: {
  row: FutureRowSnapshot
  template: ReturnType<typeof buildRecurringTemplate>
  rowConv: {
    ledgerAmountMinor: number
    originalAmount: number | null
    originalCurrency: string | null
    conversionRate: number | null
    conversionSource: 'EXCHANGE' | 'CUSTOM' | null
  }
  shared: RecurrenceShape
  expenseDate?: Date
  expenseTimeZone?: string
}): Expense & {
  originalAmount?: number
  originalCurrency?: string
  conversionRate?: number
  conversionSource?: 'EXCHANGE' | 'CUSTOM' | null
} {
  const { row, template, rowConv, shared } = args
  return {
    title: template.title,
    amount: rowConv.ledgerAmountMinor,
    expenseDate: args.expenseDate ?? row.expenseDate,
    expenseTimeZone: args.expenseTimeZone ?? row.expenseTimeZone,
    category: template.categoryId as Expense['category'],
    notes: template.notes ?? undefined,
    recurrenceRule: shared.recurrenceRule,
    recurrence: shared.recurrence,
    splitMode: template.splitMode as Expense['splitMode'],
    paidBySplitMode: template.paidBySplitMode as Expense['paidBySplitMode'],
    paidByList: template.paidByList.map((pb) => ({
      participant: pb.ledgerParticipantId,
      shares: pb.shares,
    })),
    paidFor: template.paidFor.map((pf) => ({
      participant: pf.ledgerParticipantId,
      shares: pf.shares,
    })),
    items: template.items.map((item) => ({
      title: item.title,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      amount: item.amount,
      splitMode: item.splitMode as Expense['splitMode'],
      paidFor: item.paidFor.map((pf) => ({
        participant: pf.ledgerParticipantId,
        shares: pf.shares,
      })),
    })),
    itemizedRemainder: template.itemizedRemainder
      ? {
          splitMode: template.itemizedRemainder
            .splitMode as Expense['splitMode'],
          paidFor: template.itemizedRemainder.paidFor.map((pf) => ({
            participant: pf.ledgerParticipantId,
            shares: pf.shares,
          })),
        }
      : undefined,
    documents: row.documents.map((d) => ({
      id: d.id,
      url: d.url,
      fileName: d.fileName,
      contentType: d.contentType,
      width: d.width,
      height: d.height,
    })),
    conversion: conversionFromStored({
      conversionSource: rowConv.conversionSource,
      originalCurrency: rowConv.originalCurrency,
      conversionRate: rowConv.conversionRate,
    }),
    originalAmount: rowConv.originalAmount ?? undefined,
    originalCurrency: rowConv.originalCurrency ?? undefined,
    conversionRate: rowConv.conversionRate ?? undefined,
    conversionSource: rowConv.conversionSource,
    isReimbursement: template.isReimbursement,
  } as Expense & {
    originalAmount?: number
    originalCurrency?: string
    conversionRate?: number
    conversionSource?: 'EXCHANGE' | 'CUSTOM' | null
  }
}
