import { prisma } from '@spliit/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  buildGroupActivityData,
  createSettlementExpensesForArchive,
  getGroupBalances,
  hasUnsettledBalances,
  logActivity,
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
        await logActivity(
          groupId,
          {
            type: 'GROUP_ARCHIVED',
            actor: { type: 'ACCOUNT', id: ctx.auth.user.id },
            subject: { type: 'GROUP', id: groupId },
            data: buildGroupActivityData({ summary: updated.name }),
          },
          tx,
        )
        return { group: updated }
      })
    }

    const willUnarchive = archived === false && wasAlreadyArchived

    const updated = await prisma.group.update({
      where: { id: groupId },
      data: { archived },
    })

    if (willArchive || willUnarchive) {
      await logActivity(groupId, {
        type: willArchive ? 'GROUP_ARCHIVED' : 'GROUP_UNARCHIVED',
        actor: { type: 'ACCOUNT', id: ctx.auth.user.id },
        subject: { type: 'GROUP', id: groupId },
        data: buildGroupActivityData({
          summary: willArchive ? updated.name : updated.name,
        }),
      })
    }

    return { group: updated }
  })
