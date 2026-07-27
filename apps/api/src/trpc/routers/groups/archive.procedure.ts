import { GroupType, prisma } from '@spliit/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  buildExpenseActivityData,
  buildGroupActivityData,
  logActivity,
} from '../../../lib/api/activities'
import {
  createSettlementExpensesForArchive,
  getGroupBalances,
  hasUnsettledBalances,
} from '../../../lib/api/balances'
import { resumeRecurringExpenseSeries } from '../../../lib/api/recurrence-series'
import { scheduleDefaultNotificationDispatch } from '../../../lib/notifications/dispatcher'
import { loadGroupContext, protectedProcedure } from '../../init'
import { archiveGroupOutputSchema } from '../../outputs/groups'

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
      force: z
        .boolean()
        .optional()
        .describe('Archive even when the group has non-zero balances.'),
    }),
  )
  .output(archiveGroupOutputSchema)
  .mutation(async ({ input: { groupId, archived, force = false }, ctx }) => {
    const { group, member } = await loadGroupContext({
      groupId,
      accountId: ctx.auth.user.id,
    })
    if (member.role !== 'ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only admins can archive a group',
      })
    }
    if (group.groupType === GroupType.FRIEND) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'friendLedgerNotArchivable',
      })
    }

    // Every archive decision is made while holding the group row lock. The
    // materializer follows the same Group -> RecurringExpenseSeries order,
    // so a due occurrence cannot be created between the balance precheck and
    // pausing the series.
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Group" WHERE "id" = ${groupId} FOR UPDATE`
      const lockedGroup = await tx.group.findUnique({
        where: { id: groupId },
        select: { id: true, name: true, ledgerId: true, archived: true },
      })
      if (!lockedGroup) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
      }

      const wasAlreadyArchived = lockedGroup.archived
      const willArchive = archived && !wasAlreadyArchived
      const willUnarchive = !archived && wasAlreadyArchived

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

      let settlementActivities: Awaited<
        ReturnType<typeof createSettlementExpensesForArchive>
      >['activities'] = []
      if (willArchive && force) {
        const balances = await getGroupBalances(groupId)
        if (hasUnsettledBalances(balances)) {
          const settled = await createSettlementExpensesForArchive(
            groupId,
            { accountId: ctx.auth.user.id },
            tx,
          )
          settlementActivities = settled.activities
        }
      }

      if (willArchive) {
        await tx.recurringExpenseSeries.updateMany({
          where: { ledgerId: lockedGroup.ledgerId, status: 'ACTIVE' },
          data: { status: 'PAUSED', version: { increment: 1 } },
        })
      }
      const updated = await tx.group.update({
        where: { id: groupId },
        data: { archived },
        select: { id: true, name: true, archived: true },
      })
      const activity =
        willArchive || willUnarchive
          ? await logActivity(
              groupId,
              {
                type: willArchive ? 'GROUP_ARCHIVED' : 'GROUP_UNARCHIVED',
                actor: { type: 'ACCOUNT', id: ctx.auth.user.id },
                subject: { type: 'GROUP', id: groupId },
                data: buildGroupActivityData({ summary: updated.name }),
              },
              tx,
            )
          : null
      return {
        group: updated,
        activity,
        settlementActivities,
        willArchive,
        willUnarchive,
      }
    })

    if (result.activity) {
      const activityType = result.willArchive
        ? 'GROUP_ARCHIVED'
        : 'GROUP_UNARCHIVED'
      scheduleDefaultNotificationDispatch({
        activityId: result.activity.id,
        type: activityType,
        groupId,
        actor: { type: 'ACCOUNT', id: ctx.auth.user.id },
        subject: { type: 'GROUP', id: groupId },
        data: buildGroupActivityData({ summary: result.group.name }),
        occurredAt: result.activity.time,
      })
    }
    for (const meta of result.settlementActivities) {
      scheduleDefaultNotificationDispatch({
        activityId: meta.activityId,
        type: 'EXPENSE_CREATED',
        groupId,
        actor: { type: 'ACCOUNT', id: ctx.auth.user.id },
        subject: { type: 'EXPENSE', id: meta.expenseId },
        data: buildExpenseActivityData({
          summary: meta.title,
          title: meta.title,
          amount: meta.amount,
          currencyCode: meta.currencyCode,
          date: meta.date,
        }),
        occurredAt: meta.time,
      })
    }
    if (result.willUnarchive) await resumeRecurringExpenseSeries(groupId)

    return {
      group: { id: result.group.id, archived: result.group.archived },
    }
  })
