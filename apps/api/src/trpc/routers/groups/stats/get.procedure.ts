import { z } from 'zod'

import {
  getTotalActiveUserPaidFor,
  getTotalActiveUserShare,
  getTotalGroupSpending,
  type TotalsExpense,
} from '@spliit/domain'

import { getGroupExpenses } from '../../../../lib/api'
import {
  hashLinkInviteToken,
  linkInviteTokenInput,
  loadGroupViewer,
  protectedProcedure,
} from '../../../init'
import { getStatsOutputSchema } from '../../../outputs/stats'
import {
  buildGroupStatsDashboard,
  statsPeriods,
  type StatsExpense,
} from './dashboard'

/**
 * The new "active user" is the signed-in account. We resolve it from the
 * server-side membership/ledger participant mapping so the totals no longer
 * depend on the browser's localStorage active-participant selection. For
 * pending invitees (PENDING GroupInvitation, no membership yet), there is no
 * `activeParticipantId` and the per-user totals are 0 — the FE surfaces the
 * Accept/Decline banner in that case.
 */
export const getGroupStatsProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      linkInviteToken: linkInviteTokenInput.describe(
        'Raw link-invite token from the share URL. Grants read access to pending link-invitees.',
      ),
      period: z.enum(statsPeriods).default('LATEST_ACTIVITY'),
      customRange: z
        .object({
          from: z.coerce.date(),
          to: z.coerce.date(),
        })
        .refine((range) => range.from <= range.to, {
          message: 'Custom range must end after it starts',
        })
        .describe('Required when period is CUSTOM. Inclusive date range.')
        .optional(),
    }),
  )
  .output(getStatsOutputSchema)
  .query(
    async ({
      input: { groupId, linkInviteToken, period, customRange },
      ctx,
    }) => {
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
      const dashboardExpenses: StatsExpense[] = rows.map((row) => ({
        ...row,
        expenseDate: new Date(row.expenseDate),
        paidByList: row.paidByList.map((paidBy) => ({
          shares: paidBy.shares,
          participant: paidBy.ledgerParticipant,
        })),
        paidFor: row.paidFor.map((paidFor) => ({
          shares: paidFor.shares,
          participant: paidFor.ledgerParticipant,
        })),
      }))

      return {
        totalGroupSpendings,
        totalParticipantSpendings,
        totalParticipantShare,
        activeParticipantId,
        dashboard: buildGroupStatsDashboard(
          dashboardExpenses,
          period,
          customRange,
        ),
      }
    },
  )
