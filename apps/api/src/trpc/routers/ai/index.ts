import { z } from 'zod'
import { getRecentExpenseContext } from '../../../lib/ai/context'
import { extractCategoryFromTitle } from '../../../lib/expense-form-actions'
import { hashLinkToken } from '../../../lib/invitations'
import { extractExpenseInformationFromImage } from '../../../lib/receipt-actions'
import { baseProcedure, createTRPCRouter, loadGroupViewer } from '../../init'
import { aiBulkCategorizeRouter } from './bulkCategorize'

export const aiRouter = createTRPCRouter({
  bulkCategorize: aiBulkCategorizeRouter,
  extractCategoryFromTitle: baseProcedure
    .input(
      z.object({
        description: z.string(),
        groupId: z.string().min(1),
        locale: z.string().optional(),
        linkInviteToken: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Validate group access, then fetch recent expense context + group
      // metadata. Authenticated callers: loadGroupViewer checks membership
      // + pending email invite. Unauthenticated callers with a link-invite
      // token: same helper validates the token via its hash. Callers
      // without either fall through and skip the context fetch (locale
      // hint still applies).
      const linkTokenHash = input.linkInviteToken
        ? await hashLinkToken(input.linkInviteToken)
        : null
      const accountId = ctx.auth?.user.id ?? ''
      const accountEmail = ctx.auth?.user.email ?? ''

      let recentExpenses: Awaited<
        ReturnType<typeof getRecentExpenseContext>
      >['expenses'] = []
      let groupContext: Awaited<
        ReturnType<typeof getRecentExpenseContext>
      >['group'] = { name: '', currency: '$', currencyCode: null }
      if (ctx.auth || input.linkInviteToken) {
        await loadGroupViewer({
          groupId: input.groupId,
          accountId,
          accountEmail,
          linkTokenHash,
        })
        const ctxResult = await getRecentExpenseContext(input.groupId)
        recentExpenses = ctxResult.expenses
        groupContext = ctxResult.group
      }

      return extractCategoryFromTitle(input.description, {
        recentExpenses,
        groupContext,
        locale: input.locale,
      })
    }),
  extractExpenseInformationFromImage: baseProcedure
    .input(
      z.object({
        imageUrl: z.string().url(),
        currency: z.string(),
        currencyCode: z.string().nullish(),
        groupId: z.string().min(1),
        locale: z.string().optional(),
        currentExpense: z
          .object({
            title: z.string().optional(),
            amount: z.number().optional(),
            date: z.string().optional(),
            currencyCode: z.string().optional(),
            categoryId: z.string().optional(),
            items: z
              .array(
                z.object({
                  title: z.string(),
                  unitPrice: z.number(),
                  quantity: z.number(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      let recentExpenses: Awaited<
        ReturnType<typeof getRecentExpenseContext>
      >['expenses'] = []
      let groupContext:
        Awaited<ReturnType<typeof getRecentExpenseContext>>['group'] | undefined

      if (ctx.auth) {
        await loadGroupViewer({
          groupId: input.groupId,
          accountId: ctx.auth.user.id,
          accountEmail: ctx.auth.user.email,
          linkTokenHash: null,
        })
        const context = await getRecentExpenseContext(input.groupId)
        recentExpenses = context.expenses
        groupContext = context.group
      }

      return extractExpenseInformationFromImage(
        input.imageUrl,
        {
          currency: input.currency,
          currencyCode: input.currencyCode,
        },
        {
          recentExpenses,
          groupContext,
          locale: input.locale,
          currentExpense: input.currentExpense,
        },
      )
    }),
})
