import { createTRPCRouter } from '../../../init'
import { bulkUpdateExpenseCategoriesProcedure } from './bulkUpdateCategories.procedure'
import { commonCurrenciesProcedure } from './common-currencies.procedure'
import { createGroupExpenseProcedure } from './create.procedure'
import { deleteGroupExpenseProcedure } from './delete.procedure'
import { getGroupExpenseProcedure } from './get.procedure'
import { listGroupExpensesProcedure } from './list.procedure'
import { updateGroupExpenseProcedure } from './update.procedure'

export const groupExpensesRouter = createTRPCRouter({
  list: listGroupExpensesProcedure,
  get: getGroupExpenseProcedure,
  commonCurrencies: commonCurrenciesProcedure,
  create: createGroupExpenseProcedure,
  update: updateGroupExpenseProcedure,
  delete: deleteGroupExpenseProcedure,
  bulkUpdateCategories: bulkUpdateExpenseCategoriesProcedure,
})
