import { prisma } from '@spliit/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  createSettlementExpensesForArchive,
  getGroupBalances,
  hasUnsettledBalances,
} from '../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../init'

/**
 * Set or clear the group-level `archived` flag. ADMIN only.
 * Affects every member of the group; the UI uses this to show the
 * "Archived" section in everyone's group list and to block new expenses.
 *
 * When archiving (`archived = true`) and the group has unsettled balances,
 * the mutation throws `FAILED_PRECONDITION` unless the caller passes
 * `force: true`, in which case it auto-creates one reimbursement-style
 * "Settlement" expense per non-zero leg (inside the same transaction as
 * the archive flip) so the new `Group.archived = true` state matches a
 * zeroed-out ledger.
 */
export const archiveGroupProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      archived: z.boolean(),
      force: z.boolean().optional(),
    }),
  )
  .mutation(async ({ input: { groupId, archived, force = false }, ctx }) => {
    const { member } = await loadGroupContext({
      groupId,
      accountId: ctx.auth.user.id,
    })
    if (member.role !== 'ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only admins can archive a group',
      })
    }

    // Re-archive (unarchive then archive) is always allowed because the
    // existing state already cleared any previous settlement expenses.
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { archived: true },
    })
    const wasAlreadyArchived = !!group?.archived
    const willArchive = archived && !wasAlreadyArchived

    if (willArchive && !force) {
      const balances = await getGroupBalances(groupId)
      if (hasUnsettledBalances(balances)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'Group has unsettled balances. Settle or force-archive to continue.',
        })
      }
    }

    if (willArchive && force) {
      return prisma.$transaction(async (tx) => {
        // Re-check inside the transaction in case balances changed
        // between the optimistic read above and the write.
        const balances = await getGroupBalances(groupId)
        if (hasUnsettledBalances(balances)) {
          await createSettlementExpensesForArchive(
            groupId,
            { accountId: ctx.auth.user.id },
            tx,
          )
        }
        const updated = await tx.group.update({
          where: { id: groupId },
          data: { archived: true },
        })
        return { group: updated }
      })
    }

    const updated = await prisma.group.update({
      where: { id: groupId },
      data: { archived },
    })
    return { group: updated }
  })
