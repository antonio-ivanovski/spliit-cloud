import { createStringFieldDiffer } from '../activity-diff/factories'
import type { ExpenseDiffer } from './types'

/** Detects and formats changes to the expense title. */
export const titleDiffer: ExpenseDiffer = createStringFieldDiffer({
  field: 'title',
  getValue: (expense) => expense.title,
})
