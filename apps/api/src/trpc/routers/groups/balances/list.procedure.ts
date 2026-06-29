import {
  getBalances,
  getPublicBalances,
  getSuggestedReimbursements,
  type BalanceExpense,
} from '@spliit/domain'
import { z } from 'zod'
import { getGroupExpenses } from '../../../../lib/api'
import {
  hashLinkInviteToken,
  linkInviteTokenInput,
  loadGroupViewer,
  protectedProcedure,
} from '../../../init'

export const listGroupBalancesProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      linkInviteToken: linkInviteTokenInput,
    }),
  )
  .query(async ({ input: { groupId, linkInviteToken }, ctx }) => {
    await loadGroupViewer({
      groupId,
      accountId: ctx.auth.user.id,
      accountEmail: ctx.auth.user.email,
      linkTokenHash: await hashLinkInviteToken(linkInviteToken),
    })
    const rows = await getGroupExpenses(groupId)
    // Map LedgerParticipant references to the participant-like shape the
    // domain balance functions expect, keeping the math untouched.
    const expenses: BalanceExpense[] = rows.map((row) => ({
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
    const balances = getBalances(expenses)
    const reimbursements = getSuggestedReimbursements(balances)
    const publicBalances = getPublicBalances(reimbursements)

    return { balances: publicBalances, reimbursements }
  })
