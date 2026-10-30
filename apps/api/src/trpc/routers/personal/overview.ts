import { z } from 'zod'

import { personalMonthSchema } from '@spliit/domain'

import { getPersonalOverview } from '../../../lib/personal/queries'
import { createTRPCRouter, protectedProcedure } from '../../init'
import { personalOverviewSchema } from '../../outputs/personal'

export const personalOverviewRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({ month: personalMonthSchema.optional() }))
    .output(personalOverviewSchema)
    .query(async ({ input, ctx }) => {
      return getPersonalOverview(ctx.auth.user.id, input.month)
    }),
})
