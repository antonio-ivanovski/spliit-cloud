import { validateSession } from '@/lib/auth'
import { getRuntimeFeatureFlags } from '@/lib/featureFlags'
import { spliitCloudProvider } from '@/lib/plugins/sync'
import { baseProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const pushProcedure = baseProcedure
  .input(
    z.object({
      sessionToken: z.string().min(1),
      groups: z.array(
        z.object({
          groupId: z.string().min(1),
          groupName: z.string().min(1),
        }),
      ),
    }),
  )
  .mutation(async ({ input }) => {
    const featureFlags = await getRuntimeFeatureFlags()
    if (!featureFlags.enableGroupSync) {
      throw new TRPCError({ code: 'NOT_FOUND' })
    }

    if (!spliitCloudProvider.isConfigured()) {
      throw new TRPCError({ code: 'NOT_FOUND' })
    }

    const session = await validateSession(input.sessionToken)
    if (!session) {
      throw new TRPCError({ code: 'UNAUTHORIZED' })
    }

    const groups = input.groups.map((group) => ({
      ...group,
      addedAt: new Date(),
    }))

    await spliitCloudProvider.push(session.userId, groups)

    return {
      success: true,
      syncedCount: groups.length,
    }
  })
