import { z } from 'zod'

import { prisma } from '@spliit/db'
import {
  getBalances,
  getCurrencyBalanceSummaries,
  getPublicBalances,
  getSuggestedReimbursements,
} from '@spliit/domain'

import { getGroupBalanceExpenses } from '../../../../lib/api'
import { toBalanceExpense } from '../../../../lib/api/selects/balance-expense'
import { participantDisplayNameSelect } from '../../../../lib/api/selects/participant-display-name'
import { resolveParticipantDisplayName } from '../../../../lib/invitations'
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
    const { ledger } = await loadGroupViewer({
      groupId,
      accountId: ctx.auth.user.id,
      accountEmail: ctx.auth.user.email,
      linkTokenHash: await hashLinkInviteToken(linkInviteToken),
    })
    const rows = await getGroupBalanceExpenses(groupId, ledger.id)
    const expenses = rows.map(toBalanceExpense)
    const participantIds = Array.from(
      new Set(
        expenses.flatMap((expense) =>
          [...expense.paidByList, ...expense.paidFor].map(
            (share) => share.participant.id,
          ),
        ),
      ),
    )
    const participants =
      participantIds.length === 0
        ? []
        : await prisma.ledgerParticipant.findMany({
            where: { id: { in: participantIds } },
            select: participantDisplayNameSelect(),
          })
    const balances = getBalances(expenses)
    const reimbursements = getSuggestedReimbursements(balances)
    const publicBalances = getPublicBalances(reimbursements)
    const currencyBalances = getCurrencyBalanceSummaries(
      expenses,
      ledger.currencyCode,
    )

    // Soft-removed participants stay in expense history (and thus in balance
    // math) but are excluded from groups.get.participants. Surface them here
    // so the balances UI can label settlement counterparties correctly.
    const publicParticipants = participants.map((participant) => ({
      id: participant.id,
      name: resolveParticipantDisplayName(participant),
      removed: participant.removedAt != null,
    }))

    return {
      balances: publicBalances,
      reimbursements,
      currencyBalances,
      participants: publicParticipants,
    }
  })
