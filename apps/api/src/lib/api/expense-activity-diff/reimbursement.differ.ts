import type { ExpenseDiffer } from './types'

const labels: Record<string, string> = {
  reimbursement: 'Reimbursement',
  expense: 'Expense',
}

/** Detects and formats changes to the reimbursement toggle. */
export const reimbursementDiffer: ExpenseDiffer = {
  field: 'reimbursement',

  check(oldExpense, newExpense) {
    return oldExpense.isReimbursement !== newExpense.isReimbursement
  },

  diff(oldExpense, newExpense) {
    if (!this.check(oldExpense, newExpense)) return null

    const label = (v: boolean) => labels[v ? 'reimbursement' : 'expense']
    return {
      field: 'reimbursement',
      before: label(oldExpense.isReimbursement),
      after: label(newExpense.isReimbursement),
    }
  },
}
