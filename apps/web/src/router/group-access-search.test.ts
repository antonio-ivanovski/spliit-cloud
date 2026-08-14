import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  retainSearchParams,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import {
  balancesSearchSchema,
  createExpenseSearchSchema,
  expensePreviewSearchSchema,
  groupSearchSchema,
} from './schemas'

const retained = { viewKey: 'public-secret', invite: 'invite-token' }

function Dummy() {
  return null
}

async function createGroupRouter(initialPath: string) {
  const rootRoute = createRootRoute({ component: Dummy })
  const groupRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'groups/$groupId',
    component: Dummy,
    validateSearch: groupSearchSchema,
    search: {
      middlewares: [retainSearchParams(['viewKey', 'invite'])],
    },
  })
  const expensesRoute = createRoute({
    getParentRoute: () => groupRoute,
    path: 'expenses',
    component: Dummy,
  })
  const createExpenseRoute = createRoute({
    getParentRoute: () => groupRoute,
    path: 'expenses/create',
    component: Dummy,
    validateSearch: createExpenseSearchSchema,
  })
  const expensePreviewRoute = createRoute({
    getParentRoute: () => groupRoute,
    path: 'expenses/$expenseId',
    component: Dummy,
    validateSearch: expensePreviewSearchSchema,
  })
  const balancesRoute = createRoute({
    getParentRoute: () => groupRoute,
    path: 'balances',
    component: Dummy,
    validateSearch: balancesSearchSchema,
  })
  const routeTree = rootRoute.addChildren([
    groupRoute.addChildren([
      expensesRoute,
      createExpenseRoute,
      expensePreviewRoute,
      balancesRoute,
    ]),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  await router.load()
  return router
}

function accessSearch(search: Record<string, unknown>) {
  return {
    viewKey: search.viewKey,
    invite: search.invite,
  }
}

describe('group access search retention', () => {
  it('keeps viewKey and invite across tab, expense, balances, and create navigations', async () => {
    const router = await createGroupRouter(
      '/groups/grp-1/expenses?viewKey=public-secret&invite=invite-token',
    )
    expect(accessSearch(router.state.location.search)).toEqual(retained)

    await router.navigate({
      to: '/groups/$groupId/balances',
      params: { groupId: 'grp-1' },
    })
    expect(accessSearch(router.state.location.search)).toEqual(retained)

    await router.navigate({
      to: '/groups/$groupId/balances',
      params: { groupId: 'grp-1' },
      search: { view: 'visual' },
    })
    expect(router.state.location.search).toMatchObject({
      ...retained,
      view: 'visual',
    })

    await router.navigate({
      to: '/groups/$groupId/expenses/$expenseId',
      params: { groupId: 'grp-1', expenseId: 'exp-1' },
    })
    expect(accessSearch(router.state.location.search)).toEqual(retained)

    await router.navigate({
      to: '/groups/$groupId/expenses/create',
      params: { groupId: 'grp-1' },
    })
    expect(accessSearch(router.state.location.search)).toEqual(retained)
  })
})
