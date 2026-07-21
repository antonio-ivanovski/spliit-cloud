import type { inferRouterOutputs } from '@trpc/server'
import { createTRPCRouter } from '../init'
import { accountRouter } from './account'
import { aiRouter } from './ai'
import { currencyRouter } from './currency'
import { featuresRouter } from './features'
import { friendsRouter } from './friends'
import { groupsRouter } from './groups'
import { invitationsRouter } from './invitations'
import { notificationsRouter } from './notifications'
import { uploadsRouter } from './uploads'

export const appRouter = createTRPCRouter({
  account: accountRouter,
  ai: aiRouter,
  currency: currencyRouter,
  groups: groupsRouter,
  features: featuresRouter,
  friends: friendsRouter,
  invitations: invitationsRouter,
  notifications: notificationsRouter,
  uploads: uploadsRouter,
})

export type AppRouter = typeof appRouter
export type AppRouterOutput = inferRouterOutputs<AppRouter>
