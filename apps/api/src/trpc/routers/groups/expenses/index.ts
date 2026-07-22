import { createTRPCRouter } from '../../../init'
import { bulkUpdateExpenseCategoriesProcedure } from './bulkUpdateCategories.procedure'
import { commonCurrenciesProcedure } from './common-currencies.procedure'
import { createGroupExpenseProcedure } from './create.procedure'
import { deleteGroupExpenseProcedure } from './delete.procedure'
import { getGroupExpenseProcedure } from './get.procedure'
import { listGroupExpensesProcedure } from './list.procedure'
import { listRecurringExpenseSeriesProcedure } from './series-list.procedure'
import { stopRecurrenceProcedure } from './stopRecurrence.procedure'
import { updateGroupExpenseProcedure } from './update.procedure'

export const groupExpensesRouter = createTRPCRouter({
  list: listGroupExpensesProcedure,
  series: listRecurringExpenseSeriesProcedure,
  get: getGroupExpenseProcedure,
  /** Currencies actually used by the group's expenses, for driving the UI filter. */
  commonCurrencies: commonCurrenciesProcedure,
  /**
   * Create an expense in a group.
   * Rejects if the group is archived. May fetch an FX rate when `conversion.type` is 'exchange'.
   */
  create: createGroupExpenseProcedure,
  /** Update an existing expense. Same conversion rules as create. */
  update: updateGroupExpenseProcedure,
  delete: deleteGroupExpenseProcedure,
  stopRecurrence: stopRecurrenceProcedure,
  /**
   * Recategorize up to 2000 expenses in one transaction.
   * Only expenses still on `fromCategoryId` are eligible.
   */
  bulkUpdateCategories: bulkUpdateExpenseCategoriesProcedure,
})
