import { prisma } from '@spliit/db'
import {
  getTotalActiveUserPaidFor,
  getTotalActiveUserShare,
  getTotalGroupSpending,
  type TotalsExpense,
} from '@spliit/domain'
import { z } from 'zod'
import { getGroupExpenses } from '../../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../../init'

/**
 * The new "active user" is the signed-in account. We resolve it from the
 * server-side membership/ledger participant mapping so the totals no longer
 * depend on the browser's localStorage active-participant selection.
 */
export const getGroupStatsProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
    }),
  )
  .query(async ({ input: { groupId }, ctx }) => {
    await loadGroupContext({ groupId, accountId: ctx.auth.user.id })

    const member = await prisma.groupMember.findFirst({
      where: { groupId, accountId: ctx.auth.user.id },
      include: { ledgerParticipant: true },
    })
    const activeParticipantId = member?.ledgerParticipant?.id ?? null

    const rows = await getGroupExpenses(groupId)
    const expenses: TotalsExpense[] = rows.map((row) => ({
      ...row,
      paidFor: row.paidFor.map((pf) => ({
        shares: pf.shares,
        participant: pf.ledgerParticipant,
      })),
    }))

    const totalGroupSpendings = getTotalGroupSpending(expenses)
    const totalParticipantSpendings = getTotalActiveUserPaidFor(
      activeParticipantId,
      expenses,
    )
    const totalParticipantShare = getTotalActiveUserShare(
      activeParticipantId,
      expenses,
    )

    return {
      totalGroupSpendings,
      totalParticipantSpendings,
      totalParticipantShare,
      activeParticipantId,
    }
  })
