import { bulkUpdateExpenseCategoriesInputSchema } from '@spliit/domain/schemas'
import { TRPCError } from '@trpc/server'
import { bulkUpdateExpenseCategories } from '../../../../lib/api/category-bulk'
import { loadGroupContext, protectedProcedure } from '../../../init'
import { bulkUpdateCategoriesOutputSchema } from '../../../outputs/expenses'

export const bulkUpdateExpenseCategoriesProcedure = protectedProcedure
  .input(bulkUpdateExpenseCategoriesInputSchema)
  .output(bulkUpdateCategoriesOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const { member, group } = await loadGroupContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    if (member.role !== 'ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only admins can bulk-update expense categories',
      })
    }
    if (group.archived) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This group is archived and expenses cannot be modified',
      })
    }
    try {
      const result = await bulkUpdateExpenseCategories({
        groupId: input.groupId,
        accountId: ctx.auth.user.id,
        input,
      })
      return {
        ...result,
        rows: result.rows.map((row) => ({
          ...row,
          title: row.title ?? '',
        })),
      }
    } catch (err) {
      if (err instanceof Error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err.message,
        })
      }
      throw err
    }
  })
