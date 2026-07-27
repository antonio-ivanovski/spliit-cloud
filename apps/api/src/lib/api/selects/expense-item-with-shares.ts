import type { Prisma } from '@spliit/db'
import { expenseParticipantSharesSelect } from './expense-participant-shares'

/** Expense line item scalars + paidFor share rows (list / JSON export / diffs). */
export const expenseItemWithSharesSelect = {
  id: true,
  title: true,
  unitPrice: true,
  quantity: true,
  amount: true,
  splitMode: true,
  paidFor: { select: expenseParticipantSharesSelect },
} satisfies Prisma.ExpenseItemSelect

export type ExpenseItemWithShares = Prisma.ExpenseItemGetPayload<{
  select: typeof expenseItemWithSharesSelect
}>

/** Itemized remainder header + paidFor share rows. */
export const expenseItemizedRemainderSelect = {
  splitMode: true,
  paidFor: { select: expenseParticipantSharesSelect },
} satisfies Prisma.ExpenseItemizedRemainderSelect

export type ExpenseItemizedRemainder =
  Prisma.ExpenseItemizedRemainderGetPayload<{
    select: typeof expenseItemizedRemainderSelect
  }>
