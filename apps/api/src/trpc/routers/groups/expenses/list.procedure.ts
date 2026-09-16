import { z } from 'zod'

import {
  getGroupExpenses,
  getGroupExpensesInvolvingPage,
  INVOLVING_PAGE_HIDDEN_CHUNK,
  parseExpenseListCursor,
} from '../../../../lib/api'
import { expensePermissions } from '../../../../lib/api/resource-permissions'
import { redactExpenseListShares } from '../../../../lib/group-view-redaction'
import {
  groupAccessFields,
  scopedGroupReadProcedure,
  groupViewerArgs,
  loadGroupViewer,
} from '../../../init'
import { listExpensesOutputSchema } from '../../../outputs/expenses'

const matchModeSchema = z
  .enum(['any', 'all', 'exact'])
  .optional()
  .catch(undefined)

const listExpensesInputSchema = z.object({
  groupId: z.string().min(1),
  cursor: z
    .union([z.number().int().min(0), z.string().regex(/^\d+\+\d+$/)])
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
  filter: z.string().optional(),
  locale: z.string().optional(),
  hideSettlements: z.boolean().optional(),
  /**
   * Page around expenses involving the viewer (payer-or-beneficiary) instead of
   * slicing the raw list: each page guarantees `limit` involving expenses plus
   * the hidden expenses positioned between them, so the collapsed timeline
   * shows a meaningful row count per page. Resolved against the viewer's own
   * participant — ignored without a known identity, with explicit
   * paidBy/paidFor filters, or for amount sorting.
   */
  hideNotInvolving: z.boolean().optional(),
  categories: z.array(z.string()).optional(),
  paidBy: z.array(z.string()).optional(),
  paidByMatch: matchModeSchema,
  paidFor: z.array(z.string()).optional(),
  paidForMatch: matchModeSchema,
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  minAmount: z.number().optional(),
  maxAmount: z.number().optional(),
  currencies: z.array(z.string()).optional(),
  sortBy: z
    .enum(['expenseDate', 'createdAt', 'amount'])
    .optional()
    .catch(undefined),
  sortDir: z.enum(['asc', 'desc']).optional().catch(undefined),
  ...groupAccessFields,
})

export const listGroupExpensesProcedure = scopedGroupReadProcedure(
  'spliit:expenses:read',
)
  .input(listExpensesInputSchema)
  .output(listExpensesOutputSchema)
  .query(async ({ input, ctx }) => {
    const {
      cursor = 0,
      limit = 10,
      filter,
      locale,
      hideSettlements,
      hideNotInvolving,
      categories,
      paidBy,
      paidByMatch,
      paidFor,
      paidForMatch,
      dateFrom,
      dateTo,
      minAmount,
      maxAmount,
      currencies,
      sortBy,
      sortDir,
    } = input
    const { group, ledger, member, viewer } = await loadGroupViewer(
      groupViewerArgs(input, ctx),
    )

    const toListedExpense = (
      expense: Omit<
        Awaited<ReturnType<typeof getGroupExpenses>>[number],
        'permissions'
      >,
    ) => {
      const {
        recurringSeriesCreatorAccountId,
        createdByAccountId,
        ...publicExpense
      } = expense
      const viewerExpense =
        viewer.kind === 'ACTIVE'
          ? publicExpense
          : redactExpenseListShares(publicExpense)
      return {
        ...viewerExpense,
        createdAt: new Date(expense.createdAt),
        expenseDate: new Date(expense.expenseDate),
        permissions:
          viewer.kind === 'ACTIVE' && member
            ? expensePermissions({
                role: member.role,
                accountId: ctx.auth?.user.id ?? '',
                createdByAccountId,
                recurringSeries: expense.recurringSeriesId
                  ? {
                      creatorAccountId: recurringSeriesCreatorAccountId,
                    }
                  : null,
                archived: group.archived,
              })
            : {
                canEdit: false,
                canDelete: false,
                canManageRecurrence: false,
              },
      }
    }

    const effectiveSortBy = sortBy ?? 'expenseDate'
    const viewerParticipantId = member?.ledgerParticipant?.id ?? null
    const viewerAccountId = ctx.auth?.user.id ?? null
    const useInvolvingPage =
      hideNotInvolving === true &&
      (viewerParticipantId != null || viewerAccountId != null) &&
      (effectiveSortBy === 'expenseDate' || effectiveSortBy === 'createdAt') &&
      (paidBy ?? []).length === 0 &&
      (paidFor ?? []).length === 0

    if (useInvolvingPage) {
      const { involvingOffset, hiddenSkipped } = parseExpenseListCursor(cursor)
      const page = await getGroupExpensesInvolvingPage(group.id, {
        ledgerId: ledger.id,
        involvingParticipantId: viewerParticipantId,
        involvingAccountId: viewerAccountId,
        involvingOffset,
        involvingLength: limit,
        hiddenSkipped,
        filter,
        locale,
        hideSettlements,
        categories,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount,
        currencies,
        sortBy: effectiveSortBy,
        sortDir,
      })
      const hasMore = page.hasMoreInvolving || page.hiddenPending
      return {
        expenses: page.rows.map(toListedExpense),
        hasMore,
        nextCursor: page.hiddenPending
          ? `${involvingOffset}+${hiddenSkipped + INVOLVING_PAGE_HIDDEN_CHUNK}`
          : involvingOffset +
            (hiddenSkipped > 0 ? limit : page.involvingReturned),
      }
    }

    const numericCursor = typeof cursor === 'number' ? cursor : 0
    const expenses = await getGroupExpenses(group.id, {
      ledgerId: ledger.id,
      offset: numericCursor,
      length: limit + 1,
      filter,
      locale,
      hideSettlements,
      categories,
      paidBy,
      paidByMatch,
      paidFor,
      paidForMatch,
      dateFrom,
      dateTo,
      minAmount,
      maxAmount,
      currencies,
      sortBy,
      sortDir,
    })
    return {
      expenses: expenses.slice(0, limit).map(toListedExpense),
      hasMore: !!expenses[limit],
      nextCursor: numericCursor + limit,
    }
  })
