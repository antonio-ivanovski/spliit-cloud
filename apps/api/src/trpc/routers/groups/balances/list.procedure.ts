import {
  getBalances,
  getPublicBalances,
  getSuggestedReimbursements,
  type BalanceExpense,
} from '@spliit/domain'
import { z } from 'zod'
import { getGroupExpenses } from '../../../../lib/api'
import { loadGroupViewer, protectedProcedure } from '../../../init'

export const listGroupBalancesProcedure = protectedProcedure
  .input(z.object({ groupId: z.string().min(1) }))
  .query(async ({ input: { groupId }, ctx }) => {
    await loadGroupViewer({
      groupId,
      accountId: ctx.auth.user.id,
      accountEmail: ctx.auth.user.email,
    })
    const rows = await getGroupExpenses(groupId)
    // Map LedgerParticipant references to the participant-like shape the
    // domain balance functions expect, keeping the math untouched.
    const expenses: BalanceExpense[] = rows.map((row) => ({
      ...row,
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
