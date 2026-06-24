import { inferRouterOutputs } from '@trpc/server'
import { createTRPCRouter } from '../init'
import { accountRouter } from './account'
import { aiRouter } from './ai'
import { categoriesRouter } from './categories'
import { featuresRouter } from './features'
import { groupsRouter } from './groups'
import { invitationsRouter } from './invitations'

export const appRouter = createTRPCRouter({
  account: accountRouter,
  ai: aiRouter,
  groups: groupsRouter,
  categories: categoriesRouter,
  features: featuresRouter,
  invitations: invitationsRouter,
})

export type AppRouter = typeof appRouter
export type AppRouterOutput = inferRouterOutputs<AppRouter>
