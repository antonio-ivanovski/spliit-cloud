import { describe, expect, it } from 'vitest'

import type { OfflineSnapshotOutput } from '@spliit/api/offline-contract'

import type { CatalogRecord, GroupRecord } from './contract'
import {
  OFFLINE_COPY,
  OFFLINE_INVOLVEMENT_HIDDEN_CAP,
  OFFLINE_LOCAL_PAGE_SIZE,
  applyGroupFilters,
  buildOfflineFilterOptions,
  buildOfflineOverview,
  getOfflineBalances,
  getOfflineExpense,
  offlineQueryKey,
  paginateInvolvementLocal,
  paginateLocal,
  queryGlobalExpensesOffline,
  queryGroupExpensesOffline,
  snapshotVersion,
  sortGlobalRecords,
  sortGroupRecords,
} from './read-model'

const BASE_TIME = new Date('2026-03-08T12:00:00.000Z')

function listItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'exp-1',
    title: 'Groceries',
    amount: 1000,
    expenseDate: new Date('2026-03-01T12:00:00.000Z'),
    expenseTimeZone: 'UTC',
    categoryId: 'groceries',
    category: { id: 'groceries', grouping: 'food', name: 'Groceries' },
    splitMode: 'EVENLY',
    paidBySplitMode: 'EVENLY',
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    conversionSource: null,
    originType: null,
    recurrenceSequence: null,
    items: [],
    createdAt: new Date('2026-03-01T13:00:00.000Z'),
    paidByList: [
      {
        ledgerParticipant: {
          id: 'p-alice',
          name: 'Alice',
          account: { id: 'account-alice', name: 'Alice', image: null },
          removed: false,
        },
        shares: 1,
      },
    ],
    paidFor: [
      {
        ledgerParticipant: {
          id: 'p-bob',
          name: 'Bob',
          account: { id: 'account-bob', name: 'Bob', image: null },
          removed: false,
        },
        shares: 1,
      },
    ],
    recurringSeriesId: null,
    recurringSeriesStatus: null,
    documentCount: 0,
    permissions: { canEdit: true, canDelete: true, canManageRecurrence: false },
    ...overrides,
  }
}

function detail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'exp-1',
    title: 'Groceries',
    amount: 1000,
    expenseDate: new Date('2026-03-01T12:00:00.000Z'),
    expenseTimeZone: 'UTC',
    categoryId: 'groceries',
    category: { id: 'groceries', grouping: 'food', name: 'Groceries' },
    splitMode: 'EVENLY',
    paidBySplitMode: 'EVENLY',
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    conversionSource: null,
    originType: null,
    recurrenceSequence: null,
    version: 1,
    createdAt: new Date('2026-03-01T13:00:00.000Z'),
    notes: null,
    documents: [],
    paidByList: [{ ledgerParticipantId: 'p-alice', shares: 1 }],
    paidFor: [{ ledgerParticipantId: 'p-bob', shares: 1 }],
    items: [],
    itemizedRemainder: null,
    recurringSeriesId: null,
    recurringSeries: null,
    recurrence: null,
    previousExpenseId: null,
    nextExpenseId: null,
    permissions: { canEdit: true, canDelete: true, canManageRecurrence: false },
    ...overrides,
  }
}

function record(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  const list = listItem({
    id,
    ...(overrides.list as Record<string, unknown> | undefined),
  })
  const det = detail({
    id,
    ...(overrides.detail as Record<string, unknown> | undefined),
  })
  // Keep list/detail ids in sync.
  ;(det as Record<string, unknown>).id = list.id as string
  return {
    list,
    detail: det,
  } as unknown as OfflineSnapshotOutput['expenses'][number]
}

function snapshot(
  groupId: string,
  expenses: ReturnType<typeof record>[],
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    schemaVersion: 1,
    accountId: 'account-alice',
    groupId,
    capturedAt: BASE_TIME,
    group: {
      group: {
        participants: [
          {
            id: 'p-alice',
            name: 'Alice',
            account: { id: 'account-alice', name: 'Alice', image: null },
          },
          {
            id: 'p-bob',
            name: 'Bob',
            account: { id: 'account-bob', name: 'Bob', image: null },
          },
        ],
        members: [
          { accountId: 'account-alice', ledgerParticipant: { id: 'p-alice' } },
          { accountId: 'account-bob', ledgerParticipant: { id: 'p-bob' } },
        ],
      },
      displayName: `Group ${groupId}`,
      currentLedgerParticipantId: 'p-alice',
      currentMember: { id: 'm-1', role: 'MEMBER', status: 'ACTIVE' },
      currentInvitation: null,
      linkInviteState: null,
      viewer: {
        source: 'MEMBER',
        access: 'READ_WRITE',
        canMutate: true,
        canAcceptInvitation: false,
      },
      hasSavedView: false,
    },
    overview: {
      id: groupId,
      name: `Group ${groupId}`,
      information: null,
      archived: false,
      createdAt: BASE_TIME.toISOString(),
      groupType: 'GROUP',
      ledger: { currency: 'USD', currencyCode: 'USD' },
      memberCount: 2,
      currentMemberRole: 'MEMBER',
      preference: { starred: false, hidden: false },
      displayName: `Group ${groupId}`,
      friendAccount: null,
      memberAccounts: [],
      financialSummary: {
        expenseCount: expenses.length,
        netBalance: 100,
        state: 'OWED_TO_YOU',
        latestExpenseCreatedAt: BASE_TIME.toISOString(),
      },
      access: 'MEMBER',
      viewKey: null,
      lastOpenedAt: null,
    },
    global: {
      id: groupId,
      name: `Group ${groupId}`,
      archived: false,
      hidden: false,
      groupType: 'GROUP',
      displayName: `Group ${groupId}`,
      currency: 'USD',
      currencyCode: 'USD',
      participantCount: 2,
    },
    balances: {
      balances: { 'p-alice': { paid: 1000, paidFor: 0, total: 1000 } },
      suggestedSettlements: [{ from: 'p-bob', to: 'p-alice', amount: 500 }],
      currencyBalances: [],
      participants: [
        { id: 'p-alice', name: 'Alice', removed: false },
        { id: 'p-bob', name: 'Bob', removed: false },
      ],
      settlement: {
        subgroup: { units: [], legs: [], hasInternalBalances: false },
        individual: {
          suggestedSettlements: [{ from: 'p-bob', to: 'p-alice', amount: 500 }],
          policy: 'standard',
        },
      },
    },
    expenses,
    totalCount: expenses.length,
    downloadedCount: expenses.length,
    hasMore: false,
    truncatedAt: null,
    ...overrides,
  } as unknown as OfflineSnapshotOutput
}

function groupRecord(
  groupId: string,
  snap: OfflineSnapshotOutput,
  overrides: Partial<GroupRecord> = {},
): GroupRecord {
  return {
    namespace: JSON.stringify(['http://localhost:3001', 'account-alice']),
    groupId,
    schemaVersion: 1,
    capturedAt: BASE_TIME,
    storedAt: new Date('2026-03-09T00:00:00.000Z'),
    commitNonce: `nonce-${groupId}`,
    dirtySince: null,
    payload: snap,
    ...overrides,
  }
}

function catalogWith(
  groups: Array<{ id: string; hidden?: boolean; archived?: boolean }>,
): CatalogRecord {
  return {
    namespace: JSON.stringify(['http://localhost:3001', 'account-alice']),
    capturedAt: BASE_TIME,
    schemaVersion: 1,
    groups: groups.map(({ id, hidden, archived }) => ({
      overview: {
        id,
        name: `Group ${id}`,
        information: null,
        archived: archived ?? false,
        createdAt: BASE_TIME.toISOString(),
        groupType: 'GROUP',
        ledger: { currency: 'USD', currencyCode: 'USD' },
        memberCount: 2,
        currentMemberRole: 'MEMBER',
        preference: { starred: false, hidden: hidden ?? false },
        displayName: `Group ${id}`,
        friendAccount: null,
        memberAccounts: [],
        financialSummary: {
          expenseCount: 1,
          netBalance: 100,
          state: 'OWED_TO_YOU',
          latestExpenseCreatedAt: BASE_TIME.toISOString(),
        },
        access: 'MEMBER',
        viewKey: null,
        lastOpenedAt: null,
      },
      global: {
        id,
        name: `Group ${id}`,
        archived: archived ?? false,
        hidden: hidden ?? false,
        groupType: 'GROUP',
        displayName: `Group ${id}`,
        currency: 'USD',
        currencyCode: 'USD',
        participantCount: 2,
      },
    })),
  } as unknown as CatalogRecord
}

describe('offline copy (500-cap amendment)', () => {
  it('uses the amended beyond-500 expense message', () => {
    expect(OFFLINE_COPY.expenseMissing).toContain(
      "isn't in this device's download",
    )
    expect(OFFLINE_COPY.expenseMissing).toContain('newer/older')
  })

  it('notes the recent-500 boundary offline', () => {
    expect(OFFLINE_COPY.recent500(1200)).toBe(
      'Showing recent 500 of 1200. Reconnect for older.',
    )
  })

  it('exposes group-missing, stale-balances, totals, and search hints', () => {
    expect(OFFLINE_COPY.groupMissing).toBe(
      "This group hasn't finished downloading.",
    )
    expect(OFFLINE_COPY.balancesStale).toBe('Balances may be out of date.')
    expect(OFFLINE_COPY.totalsIncomplete).toBe('Reconnect to update totals.')
    expect(OFFLINE_COPY.offlineSearchHint).toBe(
      'Offline search uses exact text; typo matching needs a connection.',
    )
  })
})

describe('offline keys and versions', () => {
  it('keeps local keys disjoint with an offline prefix', () => {
    expect(offlineQueryKey('ns', 3, 'v1', 'group', 'g1')[0]).toBe('offline')
    expect(offlineQueryKey('ns', 3, 'v1')).toEqual(['offline', 'ns', 3, 'v1'])
  })

  it('versions snapshots by storedAt + commitNonce, not server time alone', () => {
    const a = groupRecord('g1', snapshot('g1', []), {
      storedAt: new Date('2026-03-09T00:00:00.000Z'),
      commitNonce: 'nonce-a',
    })
    const b = groupRecord('g1', snapshot('g1', []), {
      storedAt: new Date('2026-03-09T00:00:00.000Z'),
      commitNonce: 'nonce-b',
    })
    expect(snapshotVersion(a)).not.toBe(snapshotVersion(b))
    expect(snapshotVersion(a)).toContain(String(a.storedAt.getTime()))
    expect(snapshotVersion(a)).toContain('nonce-a')
  })

  it('uses local page size 20 and hidden cap 100', () => {
    expect(OFFLINE_LOCAL_PAGE_SIZE).toBe(20)
    expect(OFFLINE_INVOLVEMENT_HIDDEN_CAP).toBe(100)
  })
})

describe('cold direct routes and capped details', () => {
  it('finds a never-opened detail within the 500 cap', () => {
    const expenses = Array.from({ length: 5 }, (_, index) =>
      record(`exp-${index}`),
    )
    const snap = snapshot('g1', expenses)
    const lookup = getOfflineExpense(snap, 'exp-3')
    expect(lookup.status).toBe('found')
    expect(lookup.list).toBeDefined()
    expect(lookup.detail).toBeDefined()
  })

  it('reports missing (not deletion) for ids beyond the cap', () => {
    const snap = snapshot('g1', [record('exp-1')], {
      hasMore: true,
      totalCount: 600,
    })
    const lookup = getOfflineExpense(snap, 'exp-old')
    expect(lookup.status).toBe('missing')
  })

  it('exposes full-series neighbor ids and availability', () => {
    const expenses = [
      record('a', {
        detail: {
          recurringSeriesId: 's1',
          recurrenceSequence: 1,
          previousExpenseId: null,
          nextExpenseId: 'b',
        },
        list: { recurringSeriesId: 's1', recurrenceSequence: 1 },
      }),
      record('b', {
        detail: {
          recurringSeriesId: 's1',
          recurrenceSequence: 2,
          previousExpenseId: 'a',
          nextExpenseId: 'c-missing',
        },
        list: { recurringSeriesId: 's1', recurrenceSequence: 2 },
      }),
    ]
    const snap = snapshot('g1', expenses)
    const lookup = getOfflineExpense(snap, 'b')
    expect(lookup.status).toBe('found')
    expect(lookup.previousExpenseId).toBe('a')
    expect(lookup.nextExpenseId).toBe('c-missing')
    expect(lookup.previousAvailable).toBe(true)
    expect(lookup.nextAvailable).toBe(false)
    expect(lookup.seriesExpenseIds).toEqual(['a', 'b'])
  })
})

describe('group filtering, sorting, and pagination', () => {
  it('paginates 45 expenses in 20-row local pages', () => {
    const expenses = Array.from({ length: 45 }, (_, index) =>
      record(`exp-${String(index).padStart(3, '0')}`, {
        list: {
          expenseDate: new Date(
            `2026-01-${String((index % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
          ),
          createdAt: new Date(BASE_TIME.getTime() + index * 1000),
        },
        detail: {
          expenseDate: new Date(
            `2026-01-${String((index % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
          ),
          createdAt: new Date(BASE_TIME.getTime() + index * 1000),
        },
      }),
    )
    const snap = snapshot('g1', expenses)
    const first = queryGroupExpensesOffline(snap, { offset: 0 })
    expect(first.rows).toHaveLength(20)
    expect(first.hasMore).toBe(true)
    expect(first.totalFiltered).toBe(45)
    const second = queryGroupExpensesOffline(snap, {
      offset: first.nextOffset ?? 0,
    })
    expect(second.rows).toHaveLength(20)
    const third = queryGroupExpensesOffline(snap, {
      offset: second.nextOffset ?? 0,
    })
    expect(third.rows).toHaveLength(5)
    expect(third.hasMore).toBe(false)
    const ids = [...first.rows, ...second.rows, ...third.rows].map(
      (row) => row.list.id,
    )
    expect(new Set(ids).size).toBe(45)
  })

  it('keeps group originalCurrency distinct from global base keys', () => {
    const expenses = [
      record('eur', {
        list: { originalCurrency: 'EUR' },
        detail: { originalCurrency: 'EUR' },
      }),
      record('usd', {
        list: { originalCurrency: 'USD' },
        detail: { originalCurrency: 'USD' },
      }),
    ]
    const snap = snapshot('g1', expenses)
    const filtered = applyGroupFilters(snap.expenses, { currencies: ['EUR'] })
    expect(filtered.map((row) => row.list.id)).toEqual(['eur'])
  })

  it('lets explicit categories override hideSettlements', () => {
    const expenses = [
      record('settle', {
        list: { categoryId: 'settlement' },
        detail: { categoryId: 'settlement' },
      }),
      record('food', {
        list: { categoryId: 'groceries' },
        detail: { categoryId: 'groceries' },
      }),
    ]
    const snap = snapshot('g1', expenses)
    expect(
      applyGroupFilters(snap.expenses, { hideSettlements: true }).map(
        (row) => row.list.id,
      ),
    ).toEqual(['food'])
    expect(
      applyGroupFilters(snap.expenses, {
        hideSettlements: true,
        categories: ['settlement'],
      }).map((row) => row.list.id),
    ).toEqual(['settle'])
  })

  it('preserves any/all/exact payer semantics', () => {
    const both = record('both', {
      list: {
        paidByList: [
          { ledgerParticipant: { id: 'p-alice', account: null } },
          { ledgerParticipant: { id: 'p-bob', account: null } },
        ],
      },
    })
    const snap = snapshot('g1', [both, record('solo')])
    expect(
      applyGroupFilters(snap.expenses, {
        paidBy: ['p-alice'],
        paidByMatch: 'any',
      }).map((row) => row.list.id),
    ).toEqual(expect.arrayContaining(['both']))
    expect(
      applyGroupFilters(snap.expenses, {
        paidBy: ['p-alice', 'p-bob'],
        paidByMatch: 'all',
      }).map((row) => row.list.id),
    ).toEqual(['both'])
    expect(
      applyGroupFilters(snap.expenses, {
        paidBy: ['p-alice', 'p-bob'],
        paidByMatch: 'exact',
      }).map((row) => row.list.id),
    ).toEqual(['both'])
    expect(
      applyGroupFilters(snap.expenses, {
        paidBy: ['p-alice'],
        paidByMatch: 'exact',
      }).map((row) => row.list.id),
    ).not.toContain('both')
  })

  it('applies inclusive date bounds across a DST transition', () => {
    // US DST 2026-03-08 02:00 -> 03:00; bounds stay inclusive Date comparisons.
    const before = record('before', {
      list: { expenseDate: new Date('2026-03-07T12:00:00.000Z') },
      detail: { expenseDate: new Date('2026-03-07T12:00:00.000Z') },
    })
    const day = record('day', {
      list: { expenseDate: new Date('2026-03-08T12:00:00.000Z') },
      detail: { expenseDate: new Date('2026-03-08T12:00:00.000Z') },
    })
    const after = record('after', {
      list: { expenseDate: new Date('2026-03-09T12:00:00.000Z') },
      detail: { expenseDate: new Date('2026-03-09T12:00:00.000Z') },
    })
    const snap = snapshot('g1', [before, day, after])
    const filtered = applyGroupFilters(snap.expenses, {
      dateFrom: new Date('2026-03-08T00:00:00.000Z'),
      dateTo: new Date('2026-03-08T23:59:59.999Z'),
    })
    expect(filtered.map((row) => row.list.id)).toEqual(['day'])
  })

  it('sorts group ties with fixed desc breakers and tests equal values', () => {
    const sameDate = new Date('2026-03-01T12:00:00.000Z')
    const expenses = [
      record('a', {
        list: { expenseDate: sameDate, createdAt: sameDate, amount: 100 },
        detail: { expenseDate: sameDate, createdAt: sameDate, amount: 100 },
      }),
      record('b', {
        list: { expenseDate: sameDate, createdAt: sameDate, amount: 100 },
        detail: { expenseDate: sameDate, createdAt: sameDate, amount: 100 },
      }),
    ]
    const desc = sortGroupRecords(expenses, 'expenseDate', 'desc')
    expect(desc.map((row) => row.list.id)).toEqual(['b', 'a'])
    const asc = sortGroupRecords(expenses, 'expenseDate', 'asc')
    // Group expenseDate asc still breaks createdAt/id ties descending.
    expect(asc.map((row) => row.list.id)).toEqual(['b', 'a'])
    const amountAsc = sortGroupRecords(expenses, 'amount', 'asc')
    expect(amountAsc.map((row) => row.list.id)).toEqual(['b', 'a'])
  })

  it('sorts global ties following the selected direction', () => {
    const sameDate = new Date('2026-03-01T12:00:00.000Z')
    const rows = [
      {
        ...record('a', {
          list: { expenseDate: sameDate, createdAt: sameDate },
        }),
        groupId: 'g1',
      },
      {
        ...record('b', {
          list: { expenseDate: sameDate, createdAt: sameDate },
        }),
        groupId: 'g1',
      },
    ]
    expect(
      sortGlobalRecords(rows, 'expenseDate', 'asc').map((row) => row.list.id),
    ).toEqual(['a', 'b'])
    expect(
      sortGlobalRecords(rows, 'expenseDate', 'desc').map((row) => row.list.id),
    ).toEqual(['b', 'a'])
  })

  it('searches trimmed case-insensitive substrings without fuzzy matching', () => {
    const snap = snapshot('g1', [record('a', { list: { title: 'Uber Ride' } })])
    expect(
      applyGroupFilters(snap.expenses, { search: '  uber ' }),
    ).toHaveLength(1)
    expect(applyGroupFilters(snap.expenses, { search: 'UBER' })).toHaveLength(1)
    expect(applyGroupFilters(snap.expenses, { search: 'ubber' })).toHaveLength(
      0,
    )
  })

  it('retains normalization for invalid/unknown URL filters', () => {
    const snap = snapshot('g1', [record('a')])
    expect(() =>
      applyGroupFilters(snap.expenses, {
        categories: ['not-a-category'],
        paidByMatch: 'any',
        dateFrom: new Date('invalid'),
      }),
    ).not.toThrow()
  })
})

describe('involvement collapse with hidden gaps', () => {
  function involvingFixture() {
    // 250 consecutive non-involving rows followed by involving rows.
    const hidden = Array.from({ length: 250 }, (_, index) =>
      record(`hidden-${index}`, {
        list: {
          expenseDate: new Date(BASE_TIME.getTime() - index * 1000),
          createdAt: new Date(BASE_TIME.getTime() - index * 1000),
          paidByList: [{ ledgerParticipant: { id: 'p-other', account: null } }],
          paidFor: [{ ledgerParticipant: { id: 'p-other', account: null } }],
        },
      }),
    )
    const involving = Array.from({ length: 25 }, (_, index) =>
      record(`involving-${index}`, {
        list: {
          expenseDate: new Date(BASE_TIME.getTime() + (index + 1) * 1000),
          createdAt: new Date(BASE_TIME.getTime() + (index + 1) * 1000),
        },
      }),
    )
    return snapshot('g1', [...involving, ...hidden])
  }

  it('delivers 20 involving plus capped hidden per page without gaps', () => {
    const snap = involvingFixture()
    const sorted = sortGroupRecords(snap.expenses, 'expenseDate', 'desc')
    const first = paginateInvolvementLocal(
      sorted,
      0,
      'p-alice',
      'account-alice',
    )
    expect(first.involvingReturned).toBe(20)
    expect(first.rows.length).toBeLessThanOrEqual(
      20 + OFFLINE_INVOLVEMENT_HIDDEN_CAP,
    )
    const seen: string[] = []
    let offset: number | null = 0
    let pages = 0
    while (offset !== null && pages < 10) {
      const page = paginateInvolvementLocal(
        sorted,
        offset,
        'p-alice',
        'account-alice',
      )
      for (const row of page.rows) {
        expect(seen).not.toContain(row.list.id)
        seen.push(row.list.id)
      }
      offset = page.nextOffset
      pages += 1
      if (page.rows.length === 0) break
    }
    expect(seen.length).toBe(sorted.length)
  })

  it('matches plain local pagination helpers', () => {
    const rows = Array.from({ length: 25 }, (_, index) => index)
    expect(paginateLocal(rows, 0).rows).toHaveLength(20)
    expect(paginateLocal(rows, 20).rows).toHaveLength(5)
  })
})

describe('balances render stored responses', () => {
  it('returns full-ledger balances with dirty marking', () => {
    const rec = groupRecord('g1', snapshot('g1', [record('a')]))
    const view = getOfflineBalances(rec)
    expect(view.balances.balances['p-alice']?.total).toBe(1000)
    expect(view.dirtySince).toBeNull()
    const dirty = groupRecord('g1', snapshot('g1', [record('a')]), {
      dirtySince: new Date(),
    })
    expect(getOfflineBalances(dirty).dirtySince).not.toBeNull()
  })
})

describe('overview aggregates', () => {
  it('keeps undownloaded names with UNAVAILABLE summaries', () => {
    const catalog = catalogWith([{ id: 'g1' }, { id: 'g2' }])
    const byId = new Map([
      ['g1', groupRecord('g1', snapshot('g1', [record('a')]))],
    ])
    const overview = buildOfflineOverview(catalog, byId)
    expect(overview.groups).toHaveLength(2)
    expect(
      overview.groups.find((group) => group.id === 'g2')?.financialSummary
        .state,
    ).toBe('UNAVAILABLE')
    expect(overview.totalsAvailable).toBe(false)
    expect(overview.incompleteGroupCount).toBe(1)
    expect(overview.balanceSummaries).toEqual([])
  })

  it('shows totals only when every group is ready and none is dirty', () => {
    const catalog = catalogWith([{ id: 'g1' }, { id: 'g2' }])
    const byId = new Map([
      ['g1', groupRecord('g1', snapshot('g1', [record('a')]))],
      ['g2', groupRecord('g2', snapshot('g2', [record('b')]))],
    ])
    const overview = buildOfflineOverview(catalog, byId)
    expect(overview.totalsAvailable).toBe(true)
    expect(overview.oldestCapturedAt).not.toBeNull()
    const dirtyById = new Map([
      [
        'g1',
        groupRecord('g1', snapshot('g1', [record('a')]), {
          dirtySince: new Date(),
        }),
      ],
      ['g2', groupRecord('g2', snapshot('g2', [record('b')]))],
    ])
    expect(buildOfflineOverview(catalog, dirtyById).totalsAvailable).toBe(false)
  })

  it('treats empty complete groups as normal empty, not missing', () => {
    const catalog = catalogWith([{ id: 'g1' }])
    const empty = snapshot('g1', [], { totalCount: 0, downloadedCount: 0 })
    const overview = buildOfflineOverview(
      catalog,
      new Map([['g1', groupRecord('g1', empty)]]),
    )
    expect(overview.incompleteGroupCount).toBe(0)
    expect(overview.groups[0]?.availability).toBe('ready')
  })
})

describe('global union and filter options', () => {
  it('excludes hidden+archived by default and honors explicit groupIds', () => {
    const catalog = catalogWith([
      { id: 'g1' },
      { id: 'g2', hidden: true },
      { id: 'g3', archived: true },
    ])
    const byId = new Map([
      ['g1', groupRecord('g1', snapshot('g1', [record('a')]))],
      ['g2', groupRecord('g2', snapshot('g2', [record('b')]))],
      ['g3', groupRecord('g3', snapshot('g3', [record('c')]))],
    ])
    const def = queryGlobalExpensesOffline(catalog, byId, {})
    expect(def.rows.map((row) => row.list.id)).toEqual(['a'])
    const explicit = queryGlobalExpensesOffline(catalog, byId, {
      groupIds: ['g2'],
    })
    expect(explicit.rows.map((row) => row.list.id)).toEqual(['b'])
    const archived = queryGlobalExpensesOffline(catalog, byId, {
      includeArchived: true,
    })
    expect(archived.rows.map((row) => row.list.id).sort()).toEqual(['a', 'c'])
  })

  it('requires exactly one base currency for amount filters and amount sort', () => {
    const catalog = catalogWith([{ id: 'g1' }])
    const byId = new Map([
      ['g1', groupRecord('g1', snapshot('g1', [record('a')]))],
    ])
    expect(
      queryGlobalExpensesOffline(catalog, byId, { minAmount: 100 })
        .currencyError,
    ).toBe('currency-required')
    expect(
      queryGlobalExpensesOffline(catalog, byId, {
        sortBy: 'amount',
        currencies: ['USD:USD'],
      }).currencyError,
    ).toBeNull()
    expect(
      queryGlobalExpensesOffline(catalog, byId, { sortBy: 'amount' })
        .currencyError,
    ).toBe('currency-required')
    expect(
      queryGlobalExpensesOffline(catalog, byId, {
        minAmount: 100,
        currencies: [':USD'],
      }).currencyError,
    ).toBeNull()
  })

  it('searches notes and item titles globally in addition to titles', () => {
    const withNote = record('noted', { detail: { notes: 'birthday dinner' } })
    const withItem = record('itemized', {
      detail: { items: [{ id: 'i1', title: 'oat milk', amount: 100 }] },
      list: { items: [{ id: 'i1', title: 'oat milk', amount: 100 }] },
    })
    const snap = snapshot('g1', [withNote, withItem, record('other')])
    const catalog = catalogWith([{ id: 'g1' }])
    const byId = new Map([['g1', groupRecord('g1', snap)]])
    expect(
      queryGlobalExpensesOffline(catalog, byId, {
        search: 'birthday',
      }).rows.map((row) => row.list.id),
    ).toEqual(['noted'])
    expect(
      queryGlobalExpensesOffline(catalog, byId, {
        search: 'oat milk',
      }).rows.map((row) => row.list.id),
    ).toEqual(['itemized'])
  })

  it('derives filter options offline and preserves removed identities', () => {
    const removed = record('r1', {
      list: {
        paidByList: [
          {
            ledgerParticipant: {
              id: 'p-removed',
              name: 'Old Name',
              account: null,
              removed: true,
            },
          },
        ],
      },
    })
    const snap = snapshot('g1', [removed])
    const catalog = catalogWith([{ id: 'g1' }, { id: 'g2' }])
    const byId = new Map([['g1', groupRecord('g1', snap)]])
    const options = buildOfflineFilterOptions(catalog, byId)
    expect(
      options.groups.find((group) => group.id === 'g2')?.availability,
    ).toBe('missing')
    expect(options.incompleteGroupCount).toBe(1)
    expect(options.people.some((person) => person.id === 'p-removed')).toBe(
      true,
    )
  })

  it('paginates a >100 hidden tail with hasMore until exhausted', () => {
    // Tail with fewer than 20 involving but >100 hidden must not deliver
    // unbounded rows: first chunk caps at 100 with continuation.
    const involving = Array.from({ length: 5 }, (_, index) =>
      record(`tail-involving-${index}`, {
        list: {
          expenseDate: new Date(BASE_TIME.getTime() + (index + 1) * 1000),
          createdAt: new Date(BASE_TIME.getTime() + (index + 1) * 1000),
        },
      }),
    )
    const hidden = Array.from({ length: 200 }, (_, index) =>
      record(`tail-hidden-${index}`, {
        list: {
          expenseDate: new Date(BASE_TIME.getTime() - (index + 1) * 1000),
          createdAt: new Date(BASE_TIME.getTime() - (index + 1) * 1000),
          paidByList: [{ ledgerParticipant: { id: 'p-other', account: null } }],
          paidFor: [{ ledgerParticipant: { id: 'p-other', account: null } }],
        },
      }),
    )
    const snap = snapshot('g1', [...involving, ...hidden])
    const sorted = sortGroupRecords(snap.expenses, 'expenseDate', 'desc')
    const first = paginateInvolvementLocal(
      sorted,
      0,
      'p-alice',
      'account-alice',
    )
    expect(first.involvingReturned).toBe(5)
    expect(first.rows).toHaveLength(100)
    expect(first.hasMore).toBe(true)
    expect(first.nextOffset).toBe(100)
    const second = paginateInvolvementLocal(
      sorted,
      first.nextOffset ?? 0,
      'p-alice',
      'account-alice',
    )
    expect(second.hasMore).toBe(true)
    expect(second.nextOffset).not.toBeNull()
    // Walk to exhaustion without gaps or duplicates.
    const seen: string[] = []
    let offset: number | null = 0
    let pages = 0
    while (offset !== null && pages < 10) {
      const page = paginateInvolvementLocal(
        sorted,
        offset,
        'p-alice',
        'account-alice',
      )
      for (const row of page.rows) {
        expect(seen).not.toContain(row.list.id)
        seen.push(row.list.id)
      }
      offset = page.nextOffset
      pages += 1
      if (page.rows.length === 0) break
    }
    expect(seen.length).toBe(sorted.length)
  })

  it('scopes missing/dirty counts to the currency filter', () => {
    const usdCatalog: CatalogRecord = {
      namespace: JSON.stringify(['http://localhost:3001', 'account-alice']),
      capturedAt: BASE_TIME,
      schemaVersion: 1,
      groups: [
        {
          overview: {
            id: 'g-usd',
            name: 'USD group',
            information: null,
            archived: false,
            createdAt: BASE_TIME.toISOString(),
            groupType: 'GROUP',
            ledger: { currency: 'USD', currencyCode: 'USD' },
            memberCount: 2,
            currentMemberRole: 'MEMBER',
            preference: { starred: false, hidden: false },
            displayName: 'USD group',
            friendAccount: null,
            memberAccounts: [],
            financialSummary: {
              expenseCount: 1,
              netBalance: 100,
              state: 'OWED_TO_YOU',
              latestExpenseCreatedAt: BASE_TIME.toISOString(),
            },
            access: 'MEMBER',
            viewKey: null,
            lastOpenedAt: null,
          },
          global: {
            id: 'g-usd',
            name: 'USD group',
            archived: false,
            hidden: false,
            groupType: 'GROUP',
            displayName: 'USD group',
            currency: 'USD',
            currencyCode: 'USD',
            participantCount: 2,
          },
        },
        {
          overview: {
            id: 'g-eur-missing',
            name: 'EUR missing',
            information: null,
            archived: false,
            createdAt: BASE_TIME.toISOString(),
            groupType: 'GROUP',
            ledger: { currency: 'EUR', currencyCode: 'EUR' },
            memberCount: 2,
            currentMemberRole: 'MEMBER',
            preference: { starred: false, hidden: false },
            displayName: 'EUR missing',
            friendAccount: null,
            memberAccounts: [],
            financialSummary: {
              expenseCount: 1,
              netBalance: 100,
              state: 'OWED_TO_YOU',
              latestExpenseCreatedAt: BASE_TIME.toISOString(),
            },
            access: 'MEMBER',
            viewKey: null,
            lastOpenedAt: null,
          },
          global: {
            id: 'g-eur-missing',
            name: 'EUR missing',
            archived: false,
            hidden: false,
            groupType: 'GROUP',
            displayName: 'EUR missing',
            currency: 'EUR',
            currencyCode: 'EUR',
            participantCount: 2,
          },
        },
        {
          overview: {
            id: 'g-eur-dirty',
            name: 'EUR dirty',
            information: null,
            archived: false,
            createdAt: BASE_TIME.toISOString(),
            groupType: 'GROUP',
            ledger: { currency: 'EUR', currencyCode: 'EUR' },
            memberCount: 2,
            currentMemberRole: 'MEMBER',
            preference: { starred: false, hidden: false },
            displayName: 'EUR dirty',
            friendAccount: null,
            memberAccounts: [],
            financialSummary: {
              expenseCount: 1,
              netBalance: 100,
              state: 'OWED_TO_YOU',
              latestExpenseCreatedAt: BASE_TIME.toISOString(),
            },
            access: 'MEMBER',
            viewKey: null,
            lastOpenedAt: null,
          },
          global: {
            id: 'g-eur-dirty',
            name: 'EUR dirty',
            archived: false,
            hidden: false,
            groupType: 'GROUP',
            displayName: 'EUR dirty',
            currency: 'EUR',
            currencyCode: 'EUR',
            participantCount: 2,
          },
        },
      ],
    } as unknown as CatalogRecord
    const byId = new Map([
      ['g-usd', groupRecord('g-usd', snapshot('g-usd', [record('usd-1')]))],
      [
        'g-eur-dirty',
        groupRecord('g-eur-dirty', snapshot('g-eur-dirty', [record('eur-1')]), {
          dirtySince: new Date(),
        }),
      ],
    ])
    // Currency scope USD excludes both EUR groups from counts.
    const scoped = queryGlobalExpensesOffline(usdCatalog, byId, {
      currencies: ['USD:USD'],
    })
    expect(scoped.incompleteGroupCount).toBe(0)
    expect(scoped.dirtyGroupCount).toBe(0)
    expect(scoped.rows.map((row) => row.list.id)).toEqual(['usd-1'])
    const eurScoped = queryGlobalExpensesOffline(usdCatalog, byId, {
      currencies: ['EUR:EUR'],
    })
    expect(eurScoped.incompleteGroupCount).toBe(1)
    expect(eurScoped.dirtyGroupCount).toBe(1)
  })

  it('propagates the 500-cap across the global union (P1-3)', () => {
    const catalog = catalogWith([{ id: 'g1' }, { id: 'g2' }])
    const truncated = snapshot('g1', [record('a')], {
      totalCount: 600,
      downloadedCount: 500,
      hasMore: true,
      truncatedAt: BASE_TIME,
    })
    const full = snapshot('g2', [record('b')], {
      totalCount: 1,
      downloadedCount: 1,
      hasMore: false,
      truncatedAt: null,
    })
    const byId = new Map([
      ['g1', groupRecord('g1', truncated)],
      ['g2', groupRecord('g2', full)],
    ])
    const result = queryGlobalExpensesOffline(catalog, byId, {})
    expect(result.truncatedGroupCount).toBe(1)
    expect(result.truncatedTotalCount).toBe(600)
    const clean = queryGlobalExpensesOffline(
      catalog,
      new Map([
        ['g1', groupRecord('g1', full)],
        ['g2', groupRecord('g2', full)],
      ]),
      {},
    )
    expect(clean.truncatedGroupCount).toBe(0)
    expect(clean.truncatedTotalCount).toBeNull()
  })
})
