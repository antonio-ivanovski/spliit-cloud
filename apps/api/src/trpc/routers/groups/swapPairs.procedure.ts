import { z } from 'zod'

import { prisma } from '@spliit/db'
import { computeSwapPairs } from '@spliit/domain'

import { authorizeSwapAccess } from '../../../lib/currency-swap/access'
import { toSwapExpenseInput } from '../../../lib/currency-swap/pipeline'
import { apiProcedure } from '../../init'
import { swapPairsOutputSchema } from '../../outputs/currency-swap'

/**
 * Distinct conversion pairs for a swap (no provider calls — DB only). Drives
 * the per-pair rate cards in step 2 of the wizard.
 */
export const swapPairsProcedure = apiProcedure('spliit:groups:read')
  .input(
    z.object({
      groupId: z.string().min(1),
      targetCurrencyCode: z.string().min(3).max(4),
    }),
  )
  .output(swapPairsOutputSchema)
  .query(async ({ input, ctx }) => {
    const { ledger, oldCode, newCode } = await authorizeSwapAccess({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
      targetCurrencyCode: input.targetCurrencyCode,
      action: 'preview',
    })
    const rows = await prisma.expense.findMany({
      where: { ledgerId: ledger.id },
      select: {
        id: true,
        expenseDate: true,
        amount: true,
        originalAmount: true,
        originalCurrency: true,
        conversionRate: true,
        conversionSource: true,
      },
      orderBy: [{ expenseDate: 'asc' }, { id: 'asc' }],
      take: 5001,
    })
    const inputs = rows.map(toSwapExpenseInput)
    return {
      oldCode,
      newCode,
      expenseCount: rows.length,
      pairs: computeSwapPairs(inputs, oldCode, newCode),
    }
  })
