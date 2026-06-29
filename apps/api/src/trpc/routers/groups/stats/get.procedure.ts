import {
  getTotalActiveUserPaidFor,
  getTotalActiveUserShare,
  getTotalGroupSpending,
  type TotalsExpense,
} from '@spliit/domain'
import { z } from 'zod'
import { getGroupExpenses } from '../../../../lib/api'
import {
  hashLinkInviteToken,
  linkInviteTokenInput,
  loadGroupViewer,
  protectedProcedure,
} from '../../../init'

/**
 * The new "active user" is the signed-in account. We resolve it from the
 * server-side membership/ledger participant mapping so the totals no longer
 * depend on the browser's localStorage active-participant selection. For
 * pending invitees (PENDING GroupInvitation, no membership yet), there is
 * no `activeParticipantId` and the per-user totals are 0 — the FE surfaces
 * the Accept/Decline banner in that case.
 */
export const getGroupStatsProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      linkInviteToken: linkInviteTokenInput,
    }),
  )
  .query(async ({ input: { groupId, linkInviteToken }, ctx }) => {
    const { member } = await loadGroupViewer({
      groupId,
      accountId: ctx.auth.user.id,
      accountEmail: ctx.auth.user.email,
      linkTokenHash: await hashLinkInviteToken(linkInviteToken),
    })

    const activeParticipantId = member?.ledgerParticipant?.id ?? null

    const rows = await getGroupExpenses(groupId)
    const expenses: TotalsExpense[] = rows.map((row) => ({
      ...row,
      paidByList: row.paidByList.map((pb) => ({
        shares: pb.shares,
        participant: pb.ledgerParticipant,
      })),
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
