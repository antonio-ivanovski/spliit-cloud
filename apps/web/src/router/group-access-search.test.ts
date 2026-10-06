import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  retainSearchParams,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import {
  expenseEditListLink,
  expenseEditPreviewLink,
  expenseEditSearch,
  expensePreviewCloseSearch,
  expensePreviewSearch,
} from '@/lib/expense-navigation'

import {
  activitySearchSchema,
  balancesSearchSchema,
  createExpenseSearchSchema,
  editExpenseSearchSchema,
  expensePreviewSearchSchema,
  globalExpensesSearchSchema,
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
  const editExpenseRoute = createRoute({
    getParentRoute: () => groupRoute,
    path: 'expenses/$expenseId/edit',
    component: Dummy,
    validateSearch: editExpenseSearchSchema,
  })
  const globalExpensesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'expenses',
    component: Dummy,
    validateSearch: globalExpensesSearchSchema,
  })
  const balancesRoute = createRoute({
    getParentRoute: () => groupRoute,
    path: 'balances',
    component: Dummy,
    validateSearch: balancesSearchSchema,
  })
  const activityRoute = createRoute({
    getParentRoute: () => groupRoute,
    path: 'activity',
    component: Dummy,
    validateSearch: activitySearchSchema,
  })
  const routeTree = rootRoute.addChildren([
    groupRoute.addChildren([
      expensesRoute,
      createExpenseRoute,
      expensePreviewRoute,
      editExpenseRoute,
      balancesRoute,
      activityRoute,
    ]),
    globalExpensesRoute,
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
  // Assert on `buildLocation` (the search pipeline behind `navigate`:
  // middlewares + validation + serialization). `router.navigate()` itself
  // is intentionally a no-op in this document-less environment since
  // TanStack Router 1.170.36 treats it as a server; committing to history
  // is router internals, not ours to verify here.
  it('keeps viewKey and invite across tab, expense, balances, and create navigations', async () => {
    const router = await createGroupRouter(
      '/groups/grp-1/expenses?viewKey=public-secret&invite=invite-token',
    )
    expect(accessSearch(router.state.location.search)).toEqual(retained)

    const balances = router.buildLocation({
      to: '/groups/$groupId/balances',
      params: { groupId: 'grp-1' },
    })
    expect(accessSearch(balances.search)).toEqual(retained)

    const balancesVisual = router.buildLocation({
      to: '/groups/$groupId/balances',
      params: { groupId: 'grp-1' },
      search: { view: 'visual' },
    })
    expect(balancesVisual.search).toMatchObject({
      ...retained,
      view: 'visual',
    })

    const expensePreview = router.buildLocation({
      to: '/groups/$groupId/expenses/$expenseId',
      params: { groupId: 'grp-1', expenseId: 'exp-1' },
    })
    expect(accessSearch(expensePreview.search)).toEqual(retained)

    const createExpense = router.buildLocation({
      to: '/groups/$groupId/expenses/create',
      params: { groupId: 'grp-1' },
    })
    expect(accessSearch(createExpense.search)).toEqual(retained)
  })

  it('keeps expense filters and sort when opening and closing a preview', async () => {
    const router = await createGroupRouter(
      '/groups/grp-1/expenses?expCategories=food&expSortBy=amount&expSortDir=asc&expShowSettlements=false&expShowAll=true&expMinAmount=15.5',
    )

    const preview = router.buildLocation({
      to: '/groups/$groupId/expenses/$expenseId',
      params: { groupId: 'grp-1', expenseId: 'exp-1' },
      search: expensePreviewSearch(),
    })
    expect(preview.search).toMatchObject({
      expCategories: 'food',
      expSortBy: 'amount',
      expSortDir: 'asc',
      expShowSettlements: 'false',
      expShowAll: 'true',
      expMinAmount: '15.5',
    })

    const previewRouter = await createGroupRouter(preview.href)
    const list = previewRouter.buildLocation({
      to: '/groups/$groupId/expenses',
      params: { groupId: 'grp-1' },
      search: expensePreviewCloseSearch,
    })
    expect(list.search).toMatchObject({
      expCategories: 'food',
      expSortBy: 'amount',
      expSortDir: 'asc',
      expShowSettlements: 'false',
      expShowAll: 'true',
      expMinAmount: '15.5',
    })
  })

  it('returns from group editing to its filtered preview and list', async () => {
    const previewRouter = await createGroupRouter(
      '/groups/grp-1/expenses/exp-1?expCategories=food&expSortBy=amount&expMinAmount=15.5',
    )
    const edit = previewRouter.buildLocation({
      to: '/groups/$groupId/expenses/$expenseId/edit',
      params: { groupId: 'grp-1', expenseId: 'exp-1' },
      search: expenseEditSearch('OCCURRENCE'),
    })
    expect(edit.search).toMatchObject({
      expCategories: 'food',
      expSortBy: 'amount',
      expMinAmount: '15.5',
      scope: 'OCCURRENCE',
    })

    const editRouter = await createGroupRouter(edit.href)
    const preview = editRouter.buildLocation(
      expenseEditPreviewLink('grp-1', 'exp-1'),
    )
    expect(preview.pathname).toBe('/groups/grp-1/expenses/exp-1')
    expect(preview.search).toMatchObject({
      expCategories: 'food',
      expSortBy: 'amount',
      expMinAmount: '15.5',
      scope: undefined,
    })

    const list = editRouter.buildLocation(expenseEditListLink('grp-1'))
    expect(list.search).toMatchObject({
      expCategories: 'food',
      expSortBy: 'amount',
      expMinAmount: '15.5',
      scope: undefined,
    })
  })

  it('returns from global-feed editing to the selected preview', async () => {
    const returnTo = '/expenses?q=dinner&showSettlements=false&sortBy=amount'
    const feedRouter = await createGroupRouter(
      '/expenses?q=dinner&showSettlements=false&sortBy=amount&expenseId=exp-1&expenseGroupId=grp-1',
    )
    const edit = feedRouter.buildLocation({
      to: '/groups/$groupId/expenses/$expenseId/edit',
      params: { groupId: 'grp-1', expenseId: 'exp-1' },
      search: expenseEditSearch(undefined, returnTo),
    })
    const editSearch = edit.search as Record<string, unknown>
    expect(editSearch.returnTo).toBe(returnTo)
    expect(editSearch.q).toBeUndefined()

    const editRouter = await createGroupRouter(edit.href)

    const preview = editRouter.buildLocation(
      expenseEditPreviewLink('grp-1', 'exp-1', returnTo),
    )
    expect(preview.pathname).toBe('/expenses')
    expect(preview.search).toMatchObject({
      q: 'dinner',
      showSettlements: 'false',
      sortBy: 'amount',
      expenseId: 'exp-1',
      expenseGroupId: 'grp-1',
    })
  })

  it('returns from activity editing to the activity preview', async () => {
    const returnTo = '/groups/grp-1/activity'
    const activityRouter = await createGroupRouter(
      '/groups/grp-1/activity?expenseId=exp-1',
    )
    const edit = activityRouter.buildLocation({
      to: '/groups/$groupId/expenses/$expenseId/edit',
      params: { groupId: 'grp-1', expenseId: 'exp-1' },
      search: expenseEditSearch(undefined, returnTo),
    })
    expect((edit.search as Record<string, unknown>).returnTo).toBe(returnTo)

    const editRouter = await createGroupRouter(edit.href)
    const preview = editRouter.buildLocation(
      expenseEditPreviewLink('grp-1', 'exp-1', returnTo),
    )
    expect(preview.pathname).toBe('/groups/grp-1/activity')
    expect(preview.search).toMatchObject({ expenseId: 'exp-1' })

    const list = editRouter.buildLocation(
      expenseEditListLink('grp-1', returnTo),
    )
    expect(list.pathname).toBe('/groups/grp-1/activity')
    expect((list.search as Record<string, unknown>).expenseId).toBeUndefined()
  })

  it('keeps the activity expense overlay in search params', async () => {
    const router = await createGroupRouter(
      '/groups/grp-1/activity?viewKey=public-secret&invite=invite-token',
    )
    const preview = router.buildLocation({
      to: '/groups/$groupId/activity',
      params: { groupId: 'grp-1' },
      search: (prev) => ({ ...prev, expenseId: 'exp-1' }),
    })
    expect(preview.search).toMatchObject({
      ...retained,
      expenseId: 'exp-1',
    })
  })
})
