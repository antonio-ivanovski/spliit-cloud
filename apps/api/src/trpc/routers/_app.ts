import { inferRouterOutputs } from '@trpc/server'
import { createTRPCRouter } from '../init'
import { aiRouter } from './ai'
import { categoriesRouter } from './categories'
import { featuresRouter } from './features'
import { groupsRouter } from './groups'

export const appRouter = createTRPCRouter({
  ai: aiRouter,
  groups: groupsRouter,
  categories: categoriesRouter,
  features: featuresRouter,
})

export type AppRouter = typeof appRouter
export type AppRouterOutput = inferRouterOutputs<AppRouter>
