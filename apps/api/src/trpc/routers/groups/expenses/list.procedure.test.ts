import { describe, expect, it } from 'vitest'

import '../../../../test/mocks'
import { authState, prismaMock } from '../../../../test/state'
import { groupsRouter } from '../index'

const ME = 'lp-me'
const B = 'lp-b'
const C = 'lp-c'
const ACCT = 'acct-me'

type Side = { participantId: string; accountId?: string | null }
type Fixture = {
  id: string
  date: string
  createdAt?: string
  paidBy: Side[]
  paidFor: Side[]
}

function dbRow(fx: Fixture) {
  const side = (s: Side) => ({
    shares: 100,
    ledgerParticipantId: s.participantId,
    ledgerParticipant: {
      id: s.participantId,
      displayName: s.participantId,
      removedAt: null,
      groupMember:
        s.accountId === undefined
          ? null
          : {
              account:
                s.accountId === null
                  ? null
                  : { id: s.accountId, name: s.accountId, image: null },
            },
      invitations: [],
    },
  })
  return {
    id: fx.id,
    ledgerId: 'ledger-1',
    title: fx.id,
    expenseTimeZone: 'UTC',
    amount: 1000,
    createdAt: new Date(fx.createdAt ?? fx.date),
    expenseDate: new Date(fx.date),
    categoryId: 'general',
    splitMode: 'EVENLY',
    paidBySplitMode: 'BY_AMOUNT',
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    conversionSource: null,
    recurrenceSequence: null,
    createdByAccountId: ACCT,
    paidByList: fx.paidBy.map(side),
    paidFor: fx.paidFor.map(side),
    recurringSeries: null,
    items: [],
    _count: { documents: 0 },
    fileImportSource: null,
  }
}

function testSide(rows: Side[], cond: Record<string, unknown>): boolean {
  return rows.some((row) => {
    for (const [key, value] of Object.entries(cond)) {
      if (key === 'ledgerParticipantId') {
        if (typeof value === 'object' && value !== null && 'in' in value) {
          if (!(value as { in: string[] }).in.includes(row.participantId))
            return false
        } else if (row.participantId !== value) return false
      } else if (key === 'ledgerParticipant') {
        const accountId = (value as { groupMember?: { accountId?: string } })
          ?.groupMember?.accountId
        if (accountId !== undefined && row.accountId !== accountId) return false
      } else {
        throw new Error(`unsupported side condition ${key}`)
      }
    }
    return true
  })
}

function compareValues(a: Date | string, b: Date | string): number {
  const x = a instanceof Date ? a.getTime() : a
  const y = b instanceof Date ? b.getTime() : b
  return x < y ? -1 : x > y ? 1 : 0
}

function testWhere(
  row: ReturnType<typeof dbRow>,
  where: Record<string, unknown>,
): boolean {
  const sides = (list: unknown): Side[] =>
    (list as ReturnType<typeof dbRow>['paidByList']).map((s) => ({
      participantId: s.ledgerParticipantId,
      accountId: s.ledgerParticipant.groupMember?.account?.id ?? null,
    }))
  for (const [key, value] of Object.entries(where ?? {})) {
    if (value === undefined) continue
    if (key === 'AND') {
      if (!(value as Record<string, unknown>[]).every((c) => testWhere(row, c)))
        return false
      continue
    }
    if (key === 'OR') {
      if (!(value as Record<string, unknown>[]).some((c) => testWhere(row, c)))
        return false
      continue
    }
    if (key === 'NOT') {
      if (testWhere(row, value as Record<string, unknown>)) return false
      continue
    }
    if (key === 'ledgerId') {
      if (row.ledgerId !== value) return false
      continue
    }
    if (key === 'paidByList') {
      if (
        !testSide(
          sides(row.paidByList),
          (value as { some: Record<string, unknown> }).some,
        )
      )
        return false
      continue
    }
    if (key === 'paidFor') {
      if (
        !testSide(
          sides(row.paidFor),
          (value as { some: Record<string, unknown> }).some,
        )
      )
        return false
      continue
    }
    if (key === 'expenseDate' || key === 'createdAt' || key === 'id') {
      const actual = row[key]
      for (const [op, expected] of Object.entries(
        value as Record<string, unknown>,
      )) {
        const cmp = compareValues(
          actual,
          expected instanceof Date ? expected : (expected as string),
        )
        if (op === 'lt' && !(cmp < 0)) return false
        if (op === 'gt' && !(cmp > 0)) return false
        if (op === 'lte' && !(cmp <= 0)) return false
        if (op === 'gte' && !(cmp >= 0)) return false
        if (op === 'equals' && !(cmp === 0)) return false
      }
      continue
    }
    throw new Error(`unsupported where key ${key}`)
  }
  return true
}

function seedLedger(fixtures: Fixture[]) {
  const rows = fixtures.map(dbRow)
  prismaMock.expense.findMany.mockImplementation(async (args: unknown) => {
    const { where, orderBy, skip, take } = args as {
      where: Record<string, unknown>
      orderBy: Record<string, 'asc' | 'desc'>[]
      skip?: number
      take?: number
    }
    const matched = rows.filter((row) => testWhere(row, where))
    matched.sort((a, b) => {
      for (const entry of orderBy) {
        const [field, dir] = Object.entries(entry)[0] as [
          'expenseDate' | 'createdAt' | 'id',
          'asc' | 'desc',
        ]
        const cmp = compareValues(a[field], b[field])
        if (cmp !== 0) return dir === 'desc' ? -cmp : cmp
      }
      return 0
    })
    return matched.slice(
      skip ?? 0,
      take === undefined ? undefined : (skip ?? 0) + take,
    ) as never
  })
}

function seedGroupContext(participantId: string | null) {
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'grp-1',
    ledgerId: 'ledger-1',
    groupType: 'GROUP',
    archived: false,
    ledger: { id: 'ledger-1', currencyCode: 'USD' },
  } as never)
  prismaMock.groupMember.findUnique.mockResolvedValue({
    id: 'gm-me',
    groupId: 'grp-1',
    accountId: ACCT,
    role: 'ADMIN',
    status: 'ACTIVE',
    ledgerParticipant: participantId ? { id: participantId } : null,
  } as never)
}

function makeCaller() {
  return groupsRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: ACCT,
        email: 'me@example.com',
        emailVerified: true,
        name: 'Me',
      },
    },
  } as never)
}

async function setup(participantId: string | null, fixtures: Fixture[]) {
  authState.session = {
    user: { id: ACCT },
    session: { id: 'sess-1' },
  }
  seedGroupContext(participantId)
  seedLedger(fixtures)
}

const v = (id: string, date: string, createdAt?: string): Fixture => ({
  id,
  date,
  createdAt,
  paidBy: [{ participantId: ME, accountId: ACCT }],
  paidFor: [
    { participantId: ME, accountId: ACCT },
    { participantId: B, accountId: null },
  ],
})
const h = (id: string, date: string, createdAt?: string): Fixture => ({
  id,
  date,
  createdAt,
  paidBy: [{ participantId: B, accountId: null }],
  paidFor: [
    { participantId: B, accountId: null },
    { participantId: C, accountId: null },
  ],
})

describe('groupsRouter.expenses.list with hideNotInvolving', () => {
  it('pages involving expenses with hidden context between them', async () => {
    await setup(ME, [
      v('e1', '2026-09-10T12:00:00.000Z'),
      h('e2', '2026-09-09T12:00:00.000Z'),
      v('e3', '2026-09-08T12:00:00.000Z'),
      h('e4', '2026-09-07T12:00:00.000Z'),
      v('e5', '2026-09-06T12:00:00.000Z'),
    ])
    const caller = makeCaller()

    const page1 = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 2,
      hideNotInvolving: true,
    })
    expect(page1.expenses.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4'])
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).toBe(2)

    const page2 = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 2,
      cursor: page1.nextCursor,
      hideNotInvolving: true,
    })
    expect(page2.expenses.map((e) => e.id)).toEqual(['e5'])
    expect(page2.hasMore).toBe(false)
  })

  it('keeps long hidden gaps gap-free via continuation tokens', async () => {
    const hidden: Fixture[] = Array.from({ length: 120 }, (_, i) =>
      h(`gap-${String(i).padStart(3, '0')}`, '2026-09-09T12:00:00.000Z'),
    )
    await setup(ME, [
      v('top', '2026-09-10T12:00:00.000Z'),
      ...hidden,
      v('bottom', '2026-09-08T12:00:00.000Z'),
    ])
    const caller = makeCaller()

    const page1 = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 1,
      hideNotInvolving: true,
    })
    expect(page1.expenses).toHaveLength(101)
    expect(page1.expenses[0]?.id).toBe('top')
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).toBe('0+100')

    const page2 = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 1,
      cursor: page1.nextCursor,
      hideNotInvolving: true,
    })
    expect(page2.expenses).toHaveLength(20)
    expect(page2.hasMore).toBe(true)
    expect(page2.nextCursor).toBe(1)

    const page3 = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 1,
      cursor: page2.nextCursor,
      hideNotInvolving: true,
    })
    expect(page3.expenses.map((e) => e.id)).toEqual(['bottom'])
    expect(page3.hasMore).toBe(false)

    const seen = new Set([
      ...page1.expenses.map((e) => e.id),
      ...page2.expenses.map((e) => e.id),
      ...page3.expenses.map((e) => e.id),
    ])
    expect(seen.size).toBe(122)
  })

  it('respects createdAt tiebreaks inside the same day', async () => {
    const day = '2026-09-10T00:00:00.000Z'
    await setup(ME, [
      h('early-hidden', day, '2026-09-10T11:00:00.000Z'),
      v('first', day, '2026-09-10T10:00:00.000Z'),
      h('middle-hidden', day, '2026-09-10T09:00:00.000Z'),
      v('second', day, '2026-09-10T08:00:00.000Z'),
      h('late-hidden', day, '2026-09-10T07:00:00.000Z'),
    ])
    const caller = makeCaller()

    const page1 = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 1,
      hideNotInvolving: true,
    })
    expect(page1.expenses.map((e) => e.id)).toEqual([
      'early-hidden',
      'first',
      'middle-hidden',
    ])
    expect(page1.nextCursor).toBe(1)

    const page2 = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 1,
      cursor: 1,
      hideNotInvolving: true,
    })
    expect(page2.expenses.map((e) => e.id)).toEqual(['second', 'late-hidden'])
    expect(page2.hasMore).toBe(false)
  })

  it('honors ascending order', async () => {
    await setup(ME, [
      v('e1', '2026-09-06T12:00:00.000Z'),
      h('e2', '2026-09-07T12:00:00.000Z'),
      v('e3', '2026-09-08T12:00:00.000Z'),
    ])
    const caller = makeCaller()

    const page = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 5,
      sortDir: 'asc',
      hideNotInvolving: true,
    })
    expect(page.expenses.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
    expect(page.hasMore).toBe(false)
  })

  it('treats account-linked rows as involving without a participant id', async () => {
    await setup(null, [
      {
        id: 'mine-by-account',
        date: '2026-09-10T12:00:00.000Z',
        paidBy: [{ participantId: 'lp-unlinked', accountId: ACCT }],
        paidFor: [{ participantId: 'lp-unlinked', accountId: ACCT }],
      },
      h('theirs', '2026-09-09T12:00:00.000Z'),
    ])
    const caller = makeCaller()

    const page = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 5,
      hideNotInvolving: true,
    })
    expect(page.expenses.map((e) => e.id)).toEqual([
      'mine-by-account',
      'theirs',
    ])
  })

  it('includes leading hidden expenses before the first involving row', async () => {
    await setup(ME, [
      h('hidden-newest', '2026-09-12T12:00:00.000Z'),
      h('hidden-second', '2026-09-11T12:00:00.000Z'),
      v('mine', '2026-09-10T12:00:00.000Z'),
      h('hidden-trailing', '2026-09-09T12:00:00.000Z'),
    ])
    const caller = makeCaller()

    const page = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 5,
      hideNotInvolving: true,
    })
    expect(page.expenses.map((e) => e.id)).toEqual([
      'hidden-newest',
      'hidden-second',
      'mine',
      'hidden-trailing',
    ])
    expect(page.hasMore).toBe(false)
  })

  it('includes leading hidden expenses when paging', async () => {
    await setup(ME, [
      h('hidden-top', '2026-09-11T12:00:00.000Z'),
      v('first', '2026-09-10T12:00:00.000Z'),
      h('hidden-middle', '2026-09-09T12:00:00.000Z'),
      v('second', '2026-09-08T12:00:00.000Z'),
      h('hidden-bottom', '2026-09-07T12:00:00.000Z'),
    ])
    const caller = makeCaller()

    const page1 = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 1,
      hideNotInvolving: true,
    })
    expect(page1.expenses.map((e) => e.id)).toEqual([
      'hidden-top',
      'first',
      'hidden-middle',
    ])
    expect(page1.hasMore).toBe(true)

    const page2 = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 1,
      cursor: page1.nextCursor,
      hideNotInvolving: true,
    })
    expect(page2.expenses.map((e) => e.id)).toEqual([
      'second',
      'hidden-bottom',
    ])
    expect(page2.hasMore).toBe(false)
  })

  it('includes leading hidden expenses in ascending order', async () => {
    await setup(ME, [
      h('hidden-oldest', '2026-09-06T12:00:00.000Z'),
      v('first', '2026-09-07T12:00:00.000Z'),
      v('second', '2026-09-08T12:00:00.000Z'),
    ])
    const caller = makeCaller()

    const page = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 5,
      sortDir: 'asc',
      hideNotInvolving: true,
    })
    expect(page.expenses.map((e) => e.id)).toEqual([
      'hidden-oldest',
      'first',
      'second',
    ])
    expect(page.hasMore).toBe(false)
  })

  it('returns hidden rows when nothing involves the viewer', async () => {
    await setup('lp-stranger', [
      h('a', '2026-09-10T12:00:00.000Z'),
      h('b', '2026-09-09T12:00:00.000Z'),
    ])
    const caller = makeCaller()

    // 'lp-stranger' matches no fixture row and ACCT is linked to no row.
    const page = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 5,
      hideNotInvolving: true,
    })
    expect(page.expenses.map((e) => e.id)).toEqual(['a', 'b'])
    expect(page.hasMore).toBe(false)
  })

  it('ignores the flag for amount sorting', async () => {
    await setup(ME, [
      v('e1', '2026-09-10T12:00:00.000Z'),
      h('e2', '2026-09-09T12:00:00.000Z'),
    ])
    const caller = makeCaller()

    const page = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 5,
      sortBy: 'amount',
      hideNotInvolving: true,
    })
    // Raw amount-desc slice (id tiebreak): both rows returned, not filtered.
    expect(page.expenses.map((e) => e.id)).toEqual(['e2', 'e1'])
    expect(page.nextCursor).toBe(5)
  })

  it('ignores the flag with explicit participant filters', async () => {
    await setup(ME, [
      v('e1', '2026-09-10T12:00:00.000Z'),
      h('e2', '2026-09-09T12:00:00.000Z'),
    ])
    const caller = makeCaller()

    const page = await caller.expenses.list({
      groupId: 'grp-1',
      limit: 5,
      paidBy: [B],
      hideNotInvolving: true,
    })
    // Raw slice: only e2 matches paidBy=B, involving or not.
    expect(page.expenses.map((e) => e.id)).toEqual(['e2'])
  })

  it('rejects malformed continuation cursors', async () => {
    await setup(ME, [v('e1', '2026-09-10T12:00:00.000Z')])
    const caller = makeCaller()

    await expect(
      caller.expenses.list({
        groupId: 'grp-1',
        cursor: 'nope',
        hideNotInvolving: true,
      }),
    ).rejects.toThrow()
  })
})
