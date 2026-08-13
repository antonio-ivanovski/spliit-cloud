import type { Prisma } from '@spliit/db'
import type { BalanceExpense } from '@spliit/domain'

export const balanceExpenseSelect = {
  id: true,
  ledgerId: true,
  amount: true,
  createdAt: true,
  expenseDate: true,
  expenseTimeZone: true,
  categoryId: true,
  splitMode: true,
  paidBySplitMode: true,
  originalAmount: true,
  originalCurrency: true,
  conversionRate: true,
  conversionSource: true,
  paidByList: {
    select: { ledgerParticipantId: true, shares: true },
  },
  paidFor: {
    select: { ledgerParticipantId: true, shares: true },
  },
  items: {
    select: {
      amount: true,
      splitMode: true,
      paidFor: {
        select: { ledgerParticipantId: true, shares: true },
      },
    },
  },
  itemizedRemainder: {
    select: {
      splitMode: true,
      paidFor: {
        select: { ledgerParticipantId: true, shares: true },
      },
    },
  },
} satisfies Prisma.ExpenseSelect

export type BalanceExpenseRow = Prisma.ExpenseGetPayload<{
  select: typeof balanceExpenseSelect
}>

export function toBalanceExpense(row: BalanceExpenseRow): BalanceExpense {
  return {
    id: row.id,
    amount: row.amount,
    splitMode: row.splitMode,
    paidBySplitMode: row.paidBySplitMode,
    originalAmount: row.originalAmount,
    originalCurrency: row.originalCurrency,
    conversionRate: row.conversionRate,
    conversionSource: row.conversionSource,
    paidByList: row.paidByList.map((share) => ({
      shares: share.shares,
      participant: { id: share.ledgerParticipantId },
    })),
    paidFor: row.paidFor.map((share) => ({
      shares: share.shares,
      participant: { id: share.ledgerParticipantId },
    })),
    items: row.items.map((item) => ({
      amount: item.amount,
      splitMode: item.splitMode,
      paidFor: item.paidFor.map((share) => ({
        participant: share.ledgerParticipantId,
        shares: share.shares,
      })),
    })),
    itemizedRemainder: row.itemizedRemainder
      ? {
          splitMode: row.itemizedRemainder.splitMode,
          paidFor: row.itemizedRemainder.paidFor.map((share) => ({
            participant: share.ledgerParticipantId,
            shares: share.shares,
          })),
        }
      : null,
  }
}
