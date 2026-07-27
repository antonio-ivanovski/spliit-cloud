import { createTRPCRouter } from '../../../../init'
import { createExpenseCommentProcedure } from './create.procedure'
import { deleteExpenseCommentProcedure } from './delete.procedure'
import { listExpenseCommentsProcedure } from './list.procedure'

export const expenseCommentsRouter = createTRPCRouter({
  list: listExpenseCommentsProcedure,
  create: createExpenseCommentProcedure,
  delete: deleteExpenseCommentProcedure,
})
