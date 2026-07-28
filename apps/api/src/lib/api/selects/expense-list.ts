import type { Prisma } from '@spliit/db'

import {
  expenseItemWithSharesSelect,
  expenseItemizedRemainderSelect,
} from './expense-item-with-shares'
import { expenseParticipantSharesSelect } from './expense-participant-shares'
import { expenseParticipantWithDisplayNameSelect } from './expense-participant-with-display-name'

/** Shared expense list projection (group expenses list). */
export const groupExpenseListSelect = {
  id: true,
  title: true,
  amount: true,
  createdAt: true,
  expenseDate: true,
  categoryId: true,
  isReimbursement: true,
  splitMode: true,
  paidBySplitMode: true,
  originalAmount: true,
  originalCurrency: true,
  conversionRate: true,
  conversionSource: true,
  recurrenceSequence: true,
  paidByList: { select: expenseParticipantWithDisplayNameSelect },
  paidFor: { select: expenseParticipantWithDisplayNameSelect },
  recurringSeries: {
    select: {
      id: true,
      frequency: true,
      interval: true,
      endType: true,
      occurrenceLimit: true,
      endDate: true,
      status: true,
      anchorDate: true,
      nextOccurrenceDate: true,
    },
  },
  items: { select: expenseItemWithSharesSelect },
  itemizedRemainder: { select: expenseItemizedRemainderSelect },
  _count: { select: { documents: true } },
} satisfies Prisma.ExpenseSelect

/** JSON export expense projection (legacy spliit.app wire shape fields). */
export const expenseJsonExportSelect = {
  createdAt: true,
  expenseDate: true,
  title: true,
  categoryId: true,
  amount: true,
  originalAmount: true,
  originalCurrency: true,
  conversionRate: true,
  conversionSource: true,
  paidBySplitMode: true,
  isReimbursement: true,
  splitMode: true,
  paidByList: { select: expenseParticipantWithDisplayNameSelect },
  paidFor: { select: expenseParticipantSharesSelect },
  recurringSeries: {
    select: { frequency: true, interval: true, endType: true },
  },
  items: { select: expenseItemWithSharesSelect },
  itemizedRemainder: { select: expenseItemizedRemainderSelect },
} satisfies Prisma.ExpenseSelect

/** CSV export expense projection (net-share columns only need share rows). */
export const expenseCsvExportSelect = {
  id: true,
  expenseDate: true,
  title: true,
  categoryId: true,
  amount: true,
  originalAmount: true,
  originalCurrency: true,
  conversionRate: true,
  conversionSource: true,
  paidBySplitMode: true,
  isReimbursement: true,
  splitMode: true,
  paidByList: { select: expenseParticipantSharesSelect },
  paidFor: { select: expenseParticipantSharesSelect },
} satisfies Prisma.ExpenseSelect
