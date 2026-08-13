import { z } from 'zod'

import { getGroupCommonCurrencies } from '../../../../lib/api'
import {
  hashLinkInviteToken,
  groupReadProcedure,
  linkInviteTokenInput,
  loadGroupViewer,
} from '../../../init'
import { commonCurrenciesOutputSchema } from '../../../outputs/expenses'

export const commonCurrenciesProcedure = groupReadProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      linkInviteToken: linkInviteTokenInput.describe(
        'Raw link-invite token from the share URL. Grants read access to pending link-invitees.',
      ),
    }),
  )
  .output(commonCurrenciesOutputSchema)
  .query(async ({ input: { groupId, linkInviteToken }, ctx }) => {
    await loadGroupViewer({
      groupId,
      accountId: ctx.auth?.user.id,
      accountEmail: ctx.auth?.user.email,
      linkTokenHash: await hashLinkInviteToken(linkInviteToken),
      viewerSession: ctx.groupViewerSession,
    })
    const currencies = await getGroupCommonCurrencies(groupId)
    return { currencies }
  })
