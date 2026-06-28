import { inferRouterOutputs } from '@trpc/server'
import { createTRPCRouter } from '../init'
import { accountRouter } from './account'
import { aiRouter } from './ai'
import { currencyRouter } from './currency'
import { featuresRouter } from './features'
import { groupsRouter } from './groups'
import { invitationsRouter } from './invitations'

export const appRouter = createTRPCRouter({
  account: accountRouter,
  ai: aiRouter,
  currency: currencyRouter,
  groups: groupsRouter,
  features: featuresRouter,
  invitations: invitationsRouter,
})

export type AppRouter = typeof appRouter
export type AppRouterOutput = inferRouterOutputs<AppRouter>
