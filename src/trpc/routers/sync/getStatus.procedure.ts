import { validateSession } from '@/lib/auth'
import { getRuntimeFeatureFlags } from '@/lib/featureFlags'
import { spliitCloudProvider } from '@/lib/plugins/sync'
import { baseProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const getStatusProcedure = baseProcedure
  .input(
    z.object({
      sessionToken: z.string().min(1),
    }),
  )
  .query(async ({ input }) => {
    const featureFlags = await getRuntimeFeatureFlags()
    if (!featureFlags.enableGroupSync) {
      throw new TRPCError({ code: 'NOT_FOUND' })
    }

    if (!spliitCloudProvider.isConfigured()) {
      return { connected: false }
    }

    const session = await validateSession(input.sessionToken)
    if (!session) {
      throw new TRPCError({ code: 'UNAUTHORIZED' })
    }

    const groups = await spliitCloudProvider.pull(session.userId)
    const lastSyncAt = groups.length > 0 ? groups[0].addedAt : undefined

    return {
      connected: true,
      user: {
        id: session.user.id,
        email: session.user.email,
      },
      lastSyncAt,
    }
  })
