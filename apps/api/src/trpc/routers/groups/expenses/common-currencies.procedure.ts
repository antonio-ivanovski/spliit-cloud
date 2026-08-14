import { z } from 'zod'

import { getGroupCommonCurrencies } from '../../../../lib/api'
import { groupReadProcedure, loadGroupViewer } from '../../../init'
import { commonCurrenciesOutputSchema } from '../../../outputs/expenses'

export const commonCurrenciesProcedure = groupReadProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
    }),
  )
  .output(commonCurrenciesOutputSchema)
  .query(async ({ input: { groupId }, ctx }) => {
    const { canonicalGroupId } = await loadGroupViewer({
      groupId,
      accountId: ctx.auth?.user.id,
      accountEmail: ctx.auth?.user.email,
    })
    const currencies = await getGroupCommonCurrencies(canonicalGroupId)
    return { currencies }
  })
