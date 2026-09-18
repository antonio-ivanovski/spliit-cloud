import { describe, expect, it } from 'vitest'

import '../../../test/mocks'
import { prismaMock } from '../../../test/state'
import { groupsRouter } from './index'

function makeCaller(accountId: string) {
  return groupsRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: accountId,
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
      },
    },
  } as never)
}

type BulkExpenseOpts = {
  id: string
  title?: string
  amount?: number
  expenseDate?: Date
  createdAt?: Date
  categoryId?: string
  splitMode?:
    | 'EVENLY'
    | 'BY_SHARES'
    | 'BY_PERCENTAGE'
    | 'BY_AMOUNT'
    | 'ITEMIZED'
  paidBySplitMode?:
    | 'EVENLY'
    | 'BY_SHARES'
    | 'BY_PERCENTAGE'
    | 'BY_AMOUNT'
    | 'ITEMIZED'
  originalAmount?: number | null
  originalCurrency?: string | null
  conversionRate?: number | null
  conversionSource?: 'EXCHANGE' | 'CUSTOM' | 'EXACT' | null
  version?: number
  notes?: string | null
  recurrenceSequence?: number | null
  recurringSeriesId?: string | null
  seriesStatus?: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | null
  seriesCreator?: string | null
  documents?: Array<{
    id: string
    fileName: string | null
    contentType: string | null
    width: number | null
    height: number | null
  }>
  items?: Array<{
    id: string
    title: string
    unitPrice: number
    quantity: number
    amount: number
    splitMode?:
      | 'EVENLY'
      | 'BY_SHARES'
      | 'BY_PERCENTAGE'
      | 'BY_AMOUNT'
      | 'ITEMIZED'
  }>
  removedParticipant?: boolean
}

function participantDisplay(id: string, name: string, removed = false) {
  return {
    id,
    displayName: name,
    removedAt: removed ? new Date('2026-01-02T00:00:00Z') : null,
    groupMember: {
      account: { id: `acct-${id}`, name, image: null },
    },
    invitations: [],
  }
}

function bulkRow(
  ledgerId: string,
  payerId: string,
  payeeIds: string[],
  opts: BulkExpenseOpts,
) {
  const payerDisplay = participantDisplay(payerId, `Name-${payerId}`, false)
  const payeeDisplays = payeeIds.map((id) =>
    participantDisplay(
      id,
      `Name-${id}`,
      opts.removedParticipant && id === payeeIds[1],
    ),
  )
  const allDisplays = new Map<string, ReturnType<typeof participantDisplay>>()
  allDisplays.set(payerId, payerDisplay)
  for (const d of payeeDisplays) allDisplays.set(d.id, d)

  const paidByList = [
    {
      ledgerParticipantId: payerId,
      shares: opts.amount ?? 1000,
      ledgerParticipant:
        allDisplays.get(payerId) ?? participantDisplay(payerId, payerId),
    },
  ]
  const paidFor = payeeIds.map((id) => ({
    ledgerParticipantId: id,
    shares: 1,
    ledgerParticipant:
      allDisplays.get(id) ?? participantDisplay(id, `Name-${id}`),
  }))

  return {
    id: opts.id,
    ledgerId,
    createdByAccountId: 'acct-self',
    title: opts.title ?? `Expense ${opts.id}`,
    amount: opts.amount ?? 1000,
    createdAt: opts.createdAt ?? new Date('2026-06-01T00:00:00Z'),
    expenseDate: opts.expenseDate ?? new Date('2026-06-01T00:00:00Z'),
    expenseTimeZone: 'UTC',
    categoryId: opts.categoryId ?? 'general',
    splitMode: opts.splitMode ?? 'EVENLY',
    paidBySplitMode: opts.paidBySplitMode ?? 'BY_AMOUNT',
    originalAmount: opts.originalAmount ?? null,
    originalCurrency: opts.originalCurrency ?? null,
    conversionRate: opts.conversionRate ?? null,
    conversionSource: opts.conversionSource ?? null,
    version: opts.version ?? 1,
    notes: opts.notes ?? null,
    recurrenceSequence: opts.recurrenceSequence ?? null,
    recurringSeriesId: opts.recurringSeriesId ?? null,
    fileImportSource: null,
    paidByList,
    paidFor,
    items:
      opts.items ??
      (opts.splitMode === 'ITEMIZED'
        ? [
            {
              id: `item-${opts.id}-1`,
              title: 'Item 1',
              unitPrice: 600,
              quantity: 1,
              amount: 600,
              splitMode: 'EVENLY',
              paidFor: payeeIds.map((id) => ({
                ledgerParticipantId: id,
                shares: 1,
              })),
            },
          ]
        : []),
    itemizedRemainder:
      opts.splitMode === 'ITEMIZED'
        ? {
            splitMode: 'EVENLY',
            allocationMode: 'CUSTOM',
            paidFor: payeeIds.map((id) => ({
              ledgerParticipantId: id,
              shares: 1,
            })),
          }
        : null,
    documents: opts.documents ?? [],
    recurringSeries: opts.recurringSeriesId
      ? {
          id: opts.recurringSeriesId,
          frequency: 'MONTHLY',
          interval: 1,
          endType: 'INDEFINITE',
          occurrenceLimit: null,
          endDate: null,
          status: opts.seriesStatus ?? 'ACTIVE',
          anchorDate: new Date('2026-01-01T00:00:00Z'),
          nextOccurrenceDate: new Date('2026-07-01T00:00:00Z'),
          creatorAccountId: opts.seriesCreator ?? 'acct-self',
        }
      : null,
    _count: { documents: (opts.documents ?? []).length },
  }
}

function setupSnapshotMocks(args: {
  groupId?: string
  ledgerId?: string
  accountId?: string
  role?: 'ADMIN' | 'MEMBER'
  archived?: boolean
  subgroupsEnabled?: boolean
  bulkRows?: ReturnType<typeof bulkRow>[]
  totalCount?: number
  seriesRowsById?: Map<
    string,
    Array<{ id: string; recurrenceSequence: number | null }>
  >
}) {
  const groupId = args.groupId ?? 'grp-1'
  const ledgerId = args.ledgerId ?? 'ledger-1'
  const accountId = args.accountId ?? 'acct-self'
  const bulkRows = args.bulkRows ?? []
  const totalCount = args.totalCount ?? bulkRows.length

  const member = {
    id: 'gm-self',
    groupId,
    accountId,
    role: args.role ?? 'MEMBER',
    status: 'ACTIVE',
    ledgerParticipant: { id: 'lp-self' },
  }
  const groupRow = {
    id: groupId,
    ledgerId,
    archived: args.archived ?? false,
    subgroupsEnabled: args.subgroupsEnabled ?? false,
    ledger: { id: ledgerId, currency: '$', currencyCode: 'USD' },
  }
  const fullGroup = {
    id: groupId,
    name: 'Trip',
    information: null,
    archived: args.archived ?? false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    groupType: 'GROUP',
    ledgerId,
    friendPairKey: null,
    ledger: {
      id: ledgerId,
      currency: '$',
      currencyCode: 'USD',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
    members: [
      {
        id: 'gm-self',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        groupId,
        accountId,
        role: args.role ?? 'MEMBER',
        status: 'ACTIVE',
        joinedAt: new Date('2026-01-01T00:00:00Z'),
        leftAt: null,
        account: { id: accountId, name: 'Alice', image: null },
        ledgerParticipant: {
          id: 'lp-self',
          ledgerId,
          groupMemberId: 'gm-self',
          kind: 'ACCOUNT_MEMBER',
          displayName: null,
          removedAt: null,
        },
      },
      {
        id: 'gm-other',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        groupId,
        accountId: 'acct-other',
        role: 'MEMBER',
        status: 'ACTIVE',
        joinedAt: new Date('2026-01-01T00:00:00Z'),
        leftAt: null,
        account: { id: 'acct-other', name: 'Bob', image: null },
        ledgerParticipant: {
          id: 'lp-other',
          ledgerId,
          groupMemberId: 'gm-other',
          kind: 'ACCOUNT_MEMBER',
          displayName: null,
          removedAt: null,
        },
      },
    ],
    invitations: [],
  }

  prismaMock.groupMember.findUnique.mockResolvedValue(member as never)
  prismaMock.group.findUnique.mockImplementation(async (query: unknown) => {
    const q = query as {
      include?: { members?: unknown; ledger?: unknown }
    }
    if (q.include?.members) return fullGroup as never
    return groupRow as never
  })
  prismaMock.groupInvitation.findMany.mockResolvedValue([] as never)
  prismaMock.ledgerParticipant.findMany.mockImplementation(
    async (query: unknown) => {
      const q = query as {
        where?: { kind?: unknown; id?: { in?: string[] } }
      }
      if (q.where?.kind) return [] as never
      const ids = q.where?.id?.in ?? ['lp-self', 'lp-other']
      return ids.map((id: string) => ({
        id,
        displayName: `Name-${id}`,
        removedAt: null,
        groupMember: {
          account: { id: `acct-${id}`, name: `Name-${id}`, image: null },
        },
        invitations: [],
      })) as never
    },
  )
  prismaMock.accountGroupPreference.findMany.mockResolvedValue([] as never)
  prismaMock.groupMember.findMany.mockResolvedValue([
    {
      groupId,
      role: args.role ?? 'MEMBER',
      ledgerParticipant: { id: 'lp-self' },
      group: {
        id: groupId,
        name: 'Trip',
        information: null,
        archived: args.archived ?? false,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        groupType: 'GROUP',
        friendPairKey: null,
        ledger: {
          id: ledgerId,
          currency: '$',
          currencyCode: 'USD',
          _count: { participants: 2 },
        },
        _count: { members: 2 },
        members: [
          { account: { id: accountId, name: 'Alice', image: null } },
          { account: { id: 'acct-other', name: 'Bob', image: null } },
        ],
      },
    },
  ] as never)

  prismaMock.expense.count.mockResolvedValue(totalCount as never)
  prismaMock.subgroup.findMany.mockResolvedValue([] as never)

  prismaMock.expense.findMany.mockImplementation(async (query: unknown) => {
    const q = query as {
      where?: {
        ledgerId?: string | { in?: string[] }
        recurringSeriesId?: string | { in?: string[] }
      }
      select?: Record<string, unknown>
      orderBy?: unknown
    }
    if (q.where?.recurringSeriesId) {
      const filter = q.where.recurringSeriesId as string | { in?: string[] }
      if (typeof filter === 'string') {
        const rows = args.seriesRowsById?.get(filter) ?? []
        return rows as never
      }
      const ids = filter.in ?? []
      const allRows = ids.flatMap((seriesId) => {
        const rows = args.seriesRowsById?.get(seriesId) ?? []
        return rows.map((row) => ({ ...row, recurringSeriesId: seriesId }))
      })
      return allRows as never
    }
    if (q.orderBy) {
      return bulkRows as never
    }
    if (q.select && 'version' in q.select) {
      return bulkRows as never
    }
    if (q.select && 'ledgerId' in q.select && !('id' in q.select)) {
      return bulkRows.map((row) => ({
        ledgerId: row.ledgerId,
        amount: row.amount,
        createdAt: row.createdAt,
        splitMode: row.splitMode,
        paidBySplitMode: row.paidBySplitMode,
        originalAmount: row.originalAmount,
        originalCurrency: row.originalCurrency,
        conversionRate: row.conversionRate,
        conversionSource: row.conversionSource,
        paidByList: row.paidByList.map((p) => ({
          ledgerParticipantId: p.ledgerParticipantId,
          shares: p.shares,
        })),
        paidFor: row.paidFor.map((p) => ({
          ledgerParticipantId: p.ledgerParticipantId,
          shares: p.shares,
        })),
        items: [],
        itemizedRemainder: null,
      })) as never
    }
    return bulkRows.map((row) => ({
      id: row.id,
      ledgerId: row.ledgerId,
      amount: row.amount,
      splitMode: row.splitMode,
      paidBySplitMode: row.paidBySplitMode,
      originalAmount: row.originalAmount,
      originalCurrency: row.originalCurrency,
      conversionRate: row.conversionRate,
      conversionSource: row.conversionSource,
      paidByList: row.paidByList.map((p) => ({
        ledgerParticipantId: p.ledgerParticipantId,
        shares: p.shares,
      })),
      paidFor: row.paidFor.map((p) => ({
        ledgerParticipantId: p.ledgerParticipantId,
        shares: p.shares,
      })),
      items: [],
      itemizedRemainder: null,
    })) as never
  })

  return { groupId, ledgerId, accountId, bulkRows }
}

describe('groups.offlineSnapshot content', () => {
  it('returns an empty snapshot with coherent MEMBER viewer', async () => {
    setupSnapshotMocks({ bulkRows: [] })

    const result = await makeCaller('acct-self').offlineSnapshot({
      groupId: 'grp-1',
    })

    expect(result.schemaVersion).toBe(1)
    expect(result.accountId).toBe('acct-self')
    expect(result.groupId).toBe('grp-1')
    expect(result.capturedAt).toBeInstanceOf(Date)
    expect(result.totalCount).toBe(0)
    expect(result.downloadedCount).toBe(0)
    expect(result.hasMore).toBe(false)
    expect(result.truncatedAt).toBeNull()
    expect(result.expenses).toEqual([])
    expect(result.group.viewer.source).toBe('MEMBER')
    expect(result.group.currentMember?.status).toBe('ACTIVE')
    expect(result.group.currentInvitation).toBeNull()
    expect(result.group.linkInviteState).toBeNull()
    expect(result.group.hasSavedView).toBe(false)
    expect(result.overview.access).toBe('MEMBER')
    expect(result.overview.viewKey).toBeNull()
    expect(result.overview.lastOpenedAt).toBeNull()
    expect(result.balances.balances).toEqual({})
  })

  it('exposes no document URLs or tokens', async () => {
    const rows = [
      bulkRow('ledger-1', 'lp-self', ['lp-self', 'lp-other'], {
        id: 'exp-1',
        documents: [
          {
            id: 'doc-1',
            fileName: 'receipt.jpg',
            contentType: 'image/jpeg',
            width: 800,
            height: 600,
          },
        ],
      }),
    ]
    setupSnapshotMocks({ bulkRows: rows })

    const result = await makeCaller('acct-self').offlineSnapshot({
      groupId: 'grp-1',
    })

    expect(result.expenses).toHaveLength(1)
    expect(result.expenses[0].detail.documents).toEqual([
      {
        id: 'doc-1',
        fileName: 'receipt.jpg',
        contentType: 'image/jpeg',
        width: 800,
        height: 600,
      },
    ])
    expect(result.expenses[0].list.documentCount).toBe(1)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('https://')
    expect(serialized).not.toContain('presigned')
    expect(serialized).not.toContain('"url"')
    expect(serialized).not.toContain('viewKey":"secret')
    expect(serialized).not.toContain('tokenHash')
  })

  it('preserves removed participants, itemized splits, and multi-currency conversion', async () => {
    const rows = [
      bulkRow('ledger-1', 'lp-self', ['lp-self', 'lp-other'], {
        id: 'exp-itemized',
        splitMode: 'ITEMIZED',
        removedParticipant: true,
      }),
      bulkRow('ledger-1', 'lp-self', ['lp-self', 'lp-other'], {
        id: 'exp-fx',
        title: 'Euro dinner',
        amount: 1100,
        originalAmount: 1000,
        originalCurrency: 'EUR',
        conversionRate: 1.1,
        conversionSource: 'EXCHANGE',
      }),
    ]
    setupSnapshotMocks({ bulkRows: rows })

    const result = await makeCaller('acct-self').offlineSnapshot({
      groupId: 'grp-1',
    })

    expect(result.expenses).toHaveLength(2)
    const itemized = result.expenses.find((e) => e.list.id === 'exp-itemized')!
    expect(itemized.list.splitMode).toBe('ITEMIZED')
    expect(itemized.detail.items.length).toBeGreaterThan(0)
    expect(itemized.detail.itemizedRemainder).not.toBeNull()

    const fx = result.expenses.find((e) => e.list.id === 'exp-fx')!
    expect(fx.list.originalAmount).toBe(1000)
    expect(fx.list.originalCurrency).toBe('EUR')
    expect(fx.list.conversionRate).toBe(1.1)
    expect(fx.detail.originalCurrency).toBe('EUR')
  })

  it('builds recurrence neighbors without N+1 and excludes null sequences', async () => {
    const rows = [
      bulkRow('ledger-1', 'lp-self', ['lp-self'], {
        id: 'exp-seq-1',
        recurrenceSequence: 1,
        recurringSeriesId: 'series-1',
      }),
      bulkRow('ledger-1', 'lp-self', ['lp-self'], {
        id: 'exp-seq-2',
        recurrenceSequence: 2,
        recurringSeriesId: 'series-1',
      }),
      bulkRow('ledger-1', 'lp-self', ['lp-self'], {
        id: 'exp-seq-3',
        recurrenceSequence: 3,
        recurringSeriesId: 'series-1',
      }),
      bulkRow('ledger-1', 'lp-self', ['lp-self'], {
        id: 'exp-null',
        recurrenceSequence: null,
        recurringSeriesId: 'series-1',
      }),
    ]
    setupSnapshotMocks({
      bulkRows: rows,
      seriesRowsById: new Map([
        [
          'series-1',
          [
            { id: 'exp-seq-1', recurrenceSequence: 1 },
            { id: 'exp-seq-2', recurrenceSequence: 2 },
            { id: 'exp-seq-3', recurrenceSequence: 3 },
            { id: 'exp-null', recurrenceSequence: null },
          ],
        ],
      ]),
    })

    const result = await makeCaller('acct-self').offlineSnapshot({
      groupId: 'grp-1',
    })

    const byId = new Map(result.expenses.map((e) => [e.detail.id, e.detail]))
    expect(byId.get('exp-seq-1')).toMatchObject({
      previousExpenseId: null,
      nextExpenseId: 'exp-seq-2',
    })
    expect(byId.get('exp-seq-2')).toMatchObject({
      previousExpenseId: 'exp-seq-1',
      nextExpenseId: 'exp-seq-3',
    })
    expect(byId.get('exp-seq-3')).toMatchObject({
      previousExpenseId: 'exp-seq-2',
      nextExpenseId: null,
    })
    expect(byId.get('exp-null')).toMatchObject({
      previousExpenseId: null,
      nextExpenseId: null,
    })
    for (const entry of result.expenses) {
      expect(entry.list.id).toBe(entry.detail.id)
    }
    expect(new Set(result.expenses.map((e) => e.list.id)).size).toBe(4)
  })

  it('caps at 500 newest with correct ordering and pagination metadata', async () => {
    const bulkRows = Array.from({ length: 600 }, (_, index) => {
      const n = 600 - index
      const id = `exp-${String(n).padStart(4, '0')}`
      return bulkRow('ledger-1', 'lp-self', ['lp-self'], {
        id,
        title: `Expense ${n}`,
        expenseDate: new Date(
          `2026-01-${String((n % 28) + 1).padStart(2, '0')}T00:00:00Z`,
        ),
        createdAt: new Date(1_700_000_000_000 + n * 1000),
      })
    })
    bulkRows.sort((a, b) => {
      const dateDiff = b.expenseDate.getTime() - a.expenseDate.getTime()
      if (dateDiff !== 0) return dateDiff
      const createdDiff = b.createdAt.getTime() - a.createdAt.getTime()
      if (createdDiff !== 0) return createdDiff
      return b.id.localeCompare(a.id)
    })
    const capped = bulkRows.slice(0, 500)
    setupSnapshotMocks({ bulkRows: capped, totalCount: 600 })

    const result = await makeCaller('acct-self').offlineSnapshot({
      groupId: 'grp-1',
    })

    expect(result.totalCount).toBe(600)
    expect(result.downloadedCount).toBe(500)
    expect(result.hasMore).toBe(true)
    expect(result.truncatedAt).toBeInstanceOf(Date)
    expect(result.expenses).toHaveLength(500)
    for (let i = 1; i < result.expenses.length; i++) {
      const prev = result.expenses[i - 1].list
      const curr = result.expenses[i].list
      const prevKey = `${prev.expenseDate.getTime()}:${prev.createdAt.getTime()}:${prev.id}`
      const currKey = `${curr.expenseDate.getTime()}:${curr.createdAt.getTime()}:${curr.id}`
      expect(prevKey >= currKey).toBe(true)
    }
  })

  it('returns all 400 expenses with hasMore=false when under the cap', async () => {
    const bulkRows = Array.from({ length: 400 }, (_, i) =>
      bulkRow('ledger-1', 'lp-self', ['lp-self'], {
        id: `exp-${String(i).padStart(4, '0')}`,
        expenseDate: new Date(1_700_000_000_000 + i * 1000),
        createdAt: new Date(1_700_000_000_000 + i * 1000),
      }),
    )
    bulkRows.sort((a, b) => {
      const dateDiff = b.expenseDate.getTime() - a.expenseDate.getTime()
      if (dateDiff !== 0) return dateDiff
      const createdDiff = b.createdAt.getTime() - a.createdAt.getTime()
      if (createdDiff !== 0) return createdDiff
      return b.id.localeCompare(a.id)
    })
    setupSnapshotMocks({ bulkRows, totalCount: 400 })

    const result = await makeCaller('acct-self').offlineSnapshot({
      groupId: 'grp-1',
    })

    expect(result.totalCount).toBe(400)
    expect(result.downloadedCount).toBe(400)
    expect(result.hasMore).toBe(false)
    expect(result.truncatedAt).toBeNull()
  })

  it('fetches recurrence neighbors with a single bulk query across series', async () => {
    const rows = [
      bulkRow('ledger-1', 'lp-self', ['lp-self'], {
        id: 'exp-a1',
        recurrenceSequence: 1,
        recurringSeriesId: 'series-a',
      }),
      bulkRow('ledger-1', 'lp-self', ['lp-self'], {
        id: 'exp-a2',
        recurrenceSequence: 2,
        recurringSeriesId: 'series-a',
      }),
      bulkRow('ledger-1', 'lp-self', ['lp-self'], {
        id: 'exp-b1',
        recurrenceSequence: 1,
        recurringSeriesId: 'series-b',
      }),
      bulkRow('ledger-1', 'lp-self', ['lp-self'], {
        id: 'exp-b2',
        recurrenceSequence: null,
        recurringSeriesId: 'series-b',
      }),
    ]
    setupSnapshotMocks({
      bulkRows: rows,
      seriesRowsById: new Map([
        [
          'series-a',
          [
            { id: 'exp-a1', recurrenceSequence: 1 },
            { id: 'exp-a2', recurrenceSequence: 2 },
          ],
        ],
        [
          'series-b',
          [
            { id: 'exp-b1', recurrenceSequence: 1 },
            { id: 'exp-b2', recurrenceSequence: null },
          ],
        ],
      ]),
    })

    const result = await makeCaller('acct-self').offlineSnapshot({
      groupId: 'grp-1',
    })

    const byId = new Map(result.expenses.map((e) => [e.detail.id, e.detail]))
    expect(byId.get('exp-a1')).toMatchObject({
      previousExpenseId: null,
      nextExpenseId: 'exp-a2',
    })
    expect(byId.get('exp-a2')).toMatchObject({
      previousExpenseId: 'exp-a1',
      nextExpenseId: null,
    })
    expect(byId.get('exp-b1')).toMatchObject({
      previousExpenseId: null,
      nextExpenseId: null,
    })
    expect(byId.get('exp-b2')).toMatchObject({
      previousExpenseId: null,
      nextExpenseId: null,
    })

    const seriesCalls = prismaMock.expense.findMany.mock.calls
      .map((call) => call[0] as unknown as never as Record<string, never>)
      .map(
        (args) =>
          args as unknown as {
            where?: { recurringSeriesId?: unknown }
            select?: Record<string, unknown>
          },
      )
      .filter((args) => args.where?.recurringSeriesId !== undefined)
    expect(seriesCalls).toHaveLength(1)
    expect(seriesCalls[0]!.where).toEqual({
      recurringSeriesId: {
        in: expect.arrayContaining(['series-a', 'series-b']),
      },
    })
    expect(
      (seriesCalls[0]!.where as { recurringSeriesId: { in: string[] } })
        .recurringSeriesId.in,
    ).toHaveLength(2)
    expect(seriesCalls[0]!.select).toMatchObject({
      id: true,
      recurrenceSequence: true,
      recurringSeriesId: true,
    })
  })

  it('queries capped expenses with newest-first ordering and ledger count filter', async () => {
    setupSnapshotMocks({ bulkRows: [], totalCount: 0 })

    await makeCaller('acct-self').offlineSnapshot({ groupId: 'grp-1' })

    expect(prismaMock.expense.count).toHaveBeenCalledWith({
      where: { ledgerId: 'ledger-1' },
    })
    const bulkCalls = prismaMock.expense.findMany.mock.calls
      .map((call) => call[0] as unknown as Record<string, unknown>)
      .filter((args) => args['orderBy'] !== undefined)
    expect(bulkCalls.length).toBeGreaterThan(0)
    const bulkCall = bulkCalls[0]! as {
      where: unknown
      orderBy: unknown
      take: unknown
    }
    expect(bulkCall.where).toEqual({ ledgerId: 'ledger-1' })
    expect(bulkCall.orderBy).toEqual([
      { expenseDate: 'desc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ])
    expect(bulkCall.take).toBe(500)
  })

  it('scopes snapshot catalog base to the requested group only', async () => {
    setupSnapshotMocks({ bulkRows: [] })

    await makeCaller('acct-self').offlineSnapshot({ groupId: 'grp-1' })

    const memberCalls = prismaMock.groupMember.findMany.mock.calls.map(
      (call) => call[0] as unknown as { where?: Record<string, unknown> },
    )
    expect(memberCalls.length).toBeGreaterThan(0)
    for (const args of memberCalls) {
      expect(args.where).toMatchObject({
        accountId: 'acct-self',
        groupId: 'grp-1',
      })
    }

    const preferenceCalls =
      prismaMock.accountGroupPreference.findMany.mock.calls.map(
        (call) => call[0] as unknown as { where?: Record<string, unknown> },
      )
    expect(preferenceCalls.length).toBeGreaterThan(0)
    for (const args of preferenceCalls) {
      expect(args.where).toMatchObject({
        accountId: 'acct-self',
        groupId: 'grp-1',
      })
    }

    const financialCalls = prismaMock.expense.findMany.mock.calls
      .map(
        (call) =>
          call[0] as unknown as {
            where?: { ledgerId?: unknown; recurringSeriesId?: unknown }
            select?: Record<string, unknown>
            orderBy?: unknown
          },
      )
      .filter(
        (args) =>
          args.where?.recurringSeriesId === undefined &&
          args.orderBy === undefined &&
          args.select !== undefined &&
          'ledgerId' in args.select &&
          !('id' in args.select),
      )
    expect(financialCalls.length).toBeGreaterThan(0)
    for (const args of financialCalls) {
      expect(args.where?.ledgerId).toBe('ledger-1')
    }
  })
})
