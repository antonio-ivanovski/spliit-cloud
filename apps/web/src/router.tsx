import { CompleteProfilePage } from '@/app/auth/complete-profile'
import { ForgotPasswordPage } from '@/app/auth/forgot-password'
import { ResetPasswordPage } from '@/app/auth/reset-password'
import { ActivityPageClient } from '@/app/groups/[groupId]/activity/page.client'
import BalancesAndReimbursements from '@/app/groups/[groupId]/balances/balances-and-reimbursements'
import { EditGroup } from '@/app/groups/[groupId]/edit/edit-group'
import { CreateExpenseForm } from '@/app/groups/[groupId]/expenses/create-expense-form'
import { EditExpenseForm } from '@/app/groups/[groupId]/expenses/edit-expense-form'
import GroupExpensesPageClient from '@/app/groups/[groupId]/expenses/page.client'
import GroupInformation from '@/app/groups/[groupId]/information/group-information'
import { GroupLayoutClient } from '@/app/groups/[groupId]/layout.client'
import GroupMembersPage from '@/app/groups/[groupId]/members/page.client'
import { TotalsPageClient } from '@/app/groups/[groupId]/stats/page.client'
import { CreateGroup } from '@/app/groups/create/create-group'
import { RecentGroupList } from '@/app/groups/recent-group-list'
import HomePage from '@/app/page'
import { AppShell } from '@/AppShell'
import { RequireAuth } from '@/components/require-auth'
import { trpc } from '@/trpc/client'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
} from '@tanstack/react-router'
import { Suspense } from 'react'

function ExpenseCreateRoute() {
  const { groupId } = groupRoute.useParams()
  const { data } = trpc.features.get.useQuery()
  if (!data) return null
  return <CreateExpenseForm groupId={groupId} runtimeFeatureFlags={data} />
}

function ExpenseEditRoute() {
  const { groupId, expenseId } = expenseEditRoute.useParams()
  const { data } = trpc.features.get.useQuery()
  if (!data) return null
  return (
    <EditExpenseForm
      groupId={groupId}
      expenseId={expenseId}
      runtimeFeatureFlags={data}
    />
  )
}

function GroupsLayoutRoute() {
  return (
    <Suspense>
      <RequireAuth>
        <main className="flex-1 max-w-screen-md w-full mx-auto px-4 py-6 flex flex-col gap-6">
          <Outlet />
        </main>
      </RequireAuth>
    </Suspense>
  )
}

const rootRoute = createRootRoute({ component: AppShell })
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/forgot-password',
  component: ForgotPasswordPage,
})
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/reset-password',
  component: ResetPasswordPage,
})
const completeProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/complete-profile',
  component: CompleteProfilePage,
})
const groupsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/groups',
  component: GroupsLayoutRoute,
})
const groupsIndexRoute = createRoute({
  getParentRoute: () => groupsRoute,
  path: '/',
  component: RecentGroupList,
})
const groupCreateRoute = createRoute({
  getParentRoute: () => groupsRoute,
  path: '/create',
  component: CreateGroup,
})
const groupRoute = createRoute({
  getParentRoute: () => groupsRoute,
  path: '/$groupId',
  component: () => {
    const { groupId } = groupRoute.useParams()
    return <GroupLayoutClient groupId={groupId} />
  },
})
const groupIndexRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/',
  component: () => {
    const { groupId } = groupRoute.useParams()
    return (
      <Navigate to="/groups/$groupId/expenses" params={{ groupId }} replace />
    )
  },
})
const expensesRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/expenses',
  component: () => {
    const { data } = trpc.features.get.useQuery()
    return (
      <GroupExpensesPageClient
        enableReceiptExtract={data?.enableReceiptExtract ?? false}
      />
    )
  },
})
const expenseCreateRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/expenses/create',
  component: ExpenseCreateRoute,
})
const expenseEditRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/expenses/$expenseId/edit',
  component: ExpenseEditRoute,
})
const balancesRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/balances',
  component: BalancesAndReimbursements,
})
const statsRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/stats',
  component: TotalsPageClient,
})
const activityRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/activity',
  component: ActivityPageClient,
})
const informationRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/information',
  component: () => {
    const { groupId } = groupRoute.useParams()
    return <GroupInformation groupId={groupId} />
  },
})
const editRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/edit',
  component: EditGroup,
})
const membersRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/members',
  component: GroupMembersPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  completeProfileRoute,
  groupsRoute.addChildren([
    groupsIndexRoute,
    groupCreateRoute,
    groupRoute.addChildren([
      groupIndexRoute,
      expensesRoute,
      expenseCreateRoute,
      expenseEditRoute,
      balancesRoute,
      statsRoute,
      activityRoute,
      informationRoute,
      editRoute,
      membersRoute,
    ]),
  ]),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
