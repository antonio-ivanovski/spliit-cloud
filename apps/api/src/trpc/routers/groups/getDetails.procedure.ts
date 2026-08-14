import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma } from '@spliit/db'

import { getGroup, getGroupExpensesParticipants } from '../../../lib/api'
import { redactGroupForViewer } from '../../../lib/group-view-redaction'
import { groupReadProcedure, loadGroupViewer } from '../../init'
import { getGroupDetailsOutputSchema } from '../../outputs/groups'

export const getGroupDetailsProcedure = groupReadProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
    }),
  )
  .output(getGroupDetailsOutputSchema)
  .query(async ({ input: { groupId }, ctx }) => {
    const { canonicalGroupId, viewer } = await loadGroupViewer({
      groupId,
      accountId: ctx.auth?.user.id,
      accountEmail: ctx.auth?.user.email,
    })
    const group = await getGroup(canonicalGroupId)
    if (!group) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Group not found.',
      })
    }

    const participantsWithExpenses =
      await getGroupExpensesParticipants(canonicalGroupId)
    const hasExpenses = group.ledgerId
      ? (await prisma.expense.count({ where: { ledgerId: group.ledgerId } })) >
        0
      : false
    return {
      group: viewer.kind === 'ACTIVE' ? group : redactGroupForViewer(group),
      participantsWithExpenses,
      hasExpenses,
    }
  })
