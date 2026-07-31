import type { inferRouterOutputs } from '@trpc/server'

import { createTRPCRouter } from '../init'
import { accountRouter } from './account'
import { aiRouter } from './ai'
import { assistantRouter } from './assistant'
import { currencyRouter } from './currency'
import { globalExpensesRouter } from './expenses'
import { featuresRouter } from './features'
import { friendsRouter } from './friends'
import { groupsRouter } from './groups'
import { invitationsRouter } from './invitations'
import { notificationsRouter } from './notifications'
import { overviewRouter } from './overview'
import { uploadsRouter } from './uploads'

export const appRouter = createTRPCRouter({
  account: accountRouter,
  ai: aiRouter,
  assistant: assistantRouter,
  currency: currencyRouter,
  groups: groupsRouter,
  expenses: globalExpensesRouter,
  features: featuresRouter,
  friends: friendsRouter,
  invitations: invitationsRouter,
  notifications: notificationsRouter,
  overview: overviewRouter,
  uploads: uploadsRouter,
})

export type AppRouter = typeof appRouter
export type AppRouterOutput = inferRouterOutputs<AppRouter>
