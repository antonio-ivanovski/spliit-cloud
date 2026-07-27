import { prisma } from '@spliit/db'
import {
  getBalances,
  getCurrencyBalanceSummaries,
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
import { listBalancesOutputSchema } from '../../../outputs/balances'

export const listGroupBalancesProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      linkInviteToken: linkInviteTokenInput.describe(
        'Raw link-invite token from the share URL. Grants read access to pending link-invitees.',
      ),
    }),
  )
  .output(listBalancesOutputSchema)
  .query(async ({ input: { groupId, linkInviteToken }, ctx }) => {
    await loadGroupViewer({
      groupId,
      accountId: ctx.auth.user.id,
      accountEmail: ctx.auth.user.email,
      linkTokenHash: await hashLinkInviteToken(linkInviteToken),
    })
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { ledger: { select: { currencyCode: true } } },
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
    const currencyBalances = getCurrencyBalanceSummaries(
      expenses,
      group?.ledger.currencyCode,
    )

    // Soft-removed participants stay in expense history (and thus in balance
    // math) but are excluded from groups.get.participants. Surface them here
    // so the balances UI can label settlement counterparties correctly.
    const participantsById = new Map<
      string,
      { id: string; name: string; removed: boolean }
    >()
    for (const expense of expenses) {
      for (const share of [...expense.paidByList, ...expense.paidFor]) {
        const participant = share.participant as {
          id: string
          name?: string
          removed?: boolean
        }
        const existing = participantsById.get(participant.id)
        if (!existing) {
          participantsById.set(participant.id, {
            id: participant.id,
            name: participant.name ?? '',
            removed: Boolean(participant.removed),
          })
        } else if (participant.removed) {
          existing.removed = true
        }
      }
    }

    return {
      balances: publicBalances,
      reimbursements,
      currencyBalances,
      participants: Array.from(participantsById.values()),
    }
  })
