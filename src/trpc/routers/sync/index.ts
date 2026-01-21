import { createTRPCRouter } from '@/trpc/init'
import { disconnectProcedure } from '@/trpc/routers/sync/disconnect.procedure'
import { getStatusProcedure } from '@/trpc/routers/sync/getStatus.procedure'
import { pullProcedure } from '@/trpc/routers/sync/pull.procedure'
import { pushProcedure } from '@/trpc/routers/sync/push.procedure'

export const syncRouter = createTRPCRouter({
  getStatus: getStatusProcedure,
  push: pushProcedure,
  pull: pullProcedure,
  disconnect: disconnectProcedure,
})
