import { z } from 'zod'

import { prisma } from '@spliit/db'

import { formatIsoDate, todayInTimeZone } from '../../../../lib/report/dates'
import { loadGroupContext, protectedProcedure } from '../../../init'

/**
 * Default date bounds for the PDF report dialog: earliest ledger entry through
 * today. Empty groups default both bounds to today.
 */
export const groupReportsBoundsProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      timeZone: z.string().min(1).max(100).optional(),
    }),
  )
  .query(async ({ input: { groupId, timeZone }, ctx }) => {
    const { ledger } = await loadGroupContext({
      groupId,
      accountId: ctx.auth.user.id,
    })

    const earliestRow = await prisma.expense.findFirst({
      where: { ledgerId: ledger.id },
      orderBy: { expenseDate: 'asc' },
      select: { expenseDate: true },
    })

    const today = todayInTimeZone(timeZone)
    return {
      from: earliestRow
        ? formatIsoDate(earliestRow.expenseDate)
        : formatIsoDate(today),
      to: formatIsoDate(today),
    }
  })
