import { z } from 'zod'

import { getGroupCommonCurrencies } from '../../../../lib/api'
import {
  groupAccessFields,
  groupReadProcedure,
  groupViewerArgs,
  loadGroupViewer,
} from '../../../init'
import { commonCurrenciesOutputSchema } from '../../../outputs/expenses'

export const commonCurrenciesProcedure = groupReadProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      ...groupAccessFields,
    }),
  )
  .output(commonCurrenciesOutputSchema)
  .query(async ({ input, ctx }) => {
    const { group } = await loadGroupViewer(groupViewerArgs(input, ctx))
    const currencies = await getGroupCommonCurrencies(group.id)
    return { currencies }
  })
