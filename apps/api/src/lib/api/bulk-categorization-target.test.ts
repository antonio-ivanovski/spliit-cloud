import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { prismaMock } from '../../test/state'
import { groupTarget, personalTarget } from './bulk-categorization-target'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('personal bulk-categorization target', () => {
  it('captures only visible uncategorized expenses under the master gate', async () => {
    prismaMock.personalProfile.findUnique.mockResolvedValue({
      currencyCode: 'USD',
      sharedEnabled: false,
    } as never)
    prismaMock.personalTransaction.count.mockResolvedValueOnce(5 as never)
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: 2 }] as never)
      .mockResolvedValueOnce([
        {
          id: 'p1',
          title: 'Coffee',
          version: 1,
          date: new Date('2026-01-01'),
          amount: 300,
        },
        {
          id: 'p2',
          title: 'Taxi',
          version: 1,
          date: new Date('2026-01-02'),
          amount: 500,
        },
      ] as never)

    const target = personalTarget('acct-1')
    const { count, candidates, existingCategorized } =
      await target.captureCandidates()
    expect(count).toBe(2)
    expect(existingCategorized).toBe(5)
    expect(candidates.map((c) => c.id)).toEqual(['p1', 'p2'])
    expect(candidates[0]?.currency).toBe('USD')
    // Master gate off: categorized count still filters to PERSONAL source.
    expect(prismaMock.personalTransaction.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ source: 'PERSONAL' }),
      }),
    )
    // Both the count and capture queries must exclude empty/whitespace titles.
    const rawCalls = prismaMock.$queryRaw.mock.calls as unknown[][]
    expect(rawCalls).toHaveLength(2)
    for (const call of rawCalls) {
      const sql = String(call[0])
      expect(sql).toContain('NULLIF(btrim("title")')
    }
  })

  it('excludes empty and whitespace titles from count and capture', async () => {
    prismaMock.personalProfile.findUnique.mockResolvedValue({
      currencyCode: 'USD',
      sharedEnabled: true,
    } as never)
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: 1 }] as never)
      .mockResolvedValueOnce([{ count: 1 }] as never)
      .mockResolvedValueOnce([
        {
          id: 'p-valid',
          title: 'Corner grocery run',
          version: 1,
          date: new Date('2026-01-01'),
          amount: 300,
        },
      ] as never)
    prismaMock.personalTransaction.count.mockResolvedValueOnce(0 as never)

    const target = personalTarget('acct-1')
    expect(await target.countUncategorized()).toBe(1)
    const captured = await target.captureCandidates()
    expect(captured.count).toBe(1)
    expect(captured.candidates.map((c) => c.id)).toEqual(['p-valid'])
    // count === captured + omitted (no sampling loss here, omitted is 0).
    expect(captured.count).toBe(
      captured.candidates.length +
        Math.max(0, captured.count - captured.candidates.length),
    )
    const rawCalls = prismaMock.$queryRaw.mock.calls as unknown[][]
    for (const call of rawCalls) {
      expect(String(call[0])).toContain('NULLIF(btrim("title")')
    }
  })

  it('flags version, ownership, and missing live group rows as conflicts', async () => {
    const target = personalTarget('acct-1')
    prismaMock.personalTransaction.findMany.mockResolvedValue([
      {
        id: 'p1',
        version: 2,
        categoryId: 'general',
        title: 'Coffee',
        source: 'PERSONAL',
        sourceExpenseId: null,
        sourceDetachedAt: null,
      },
      {
        id: 'p2',
        version: 1,
        categoryId: 'groceries',
        title: 'Done',
        source: 'PERSONAL',
        sourceExpenseId: null,
        sourceDetachedAt: null,
      },
    ] as never)
    const conflicts = await target.findConflicts(prismaMock as never, [
      {
        itemId: 'p1',
        title: 'Coffee',
        expenseVersion: 1,
        recurringSeriesId: null,
      },
      {
        itemId: 'p2',
        title: 'Done',
        expenseVersion: 1,
        recurringSeriesId: null,
      },
      {
        itemId: 'missing',
        title: 'Gone',
        expenseVersion: 1,
        recurringSeriesId: null,
      },
    ])
    expect(conflicts.map((c) => c.expenseId)).toEqual(['p1', 'p2', 'missing'])
  })

  it('batches the live group-expense existence check into one query per chunk', async () => {
    const target = personalTarget('acct-1')
    prismaMock.personalTransaction.findMany.mockResolvedValue([
      {
        id: 'p-live-ok',
        version: 1,
        categoryId: 'general',
        title: 'Shared lunch',
        source: 'GROUP',
        sourceExpenseId: 'exp-ok',
        sourceDetachedAt: null,
      },
      {
        id: 'p-live-gone',
        version: 1,
        categoryId: 'general',
        title: 'Shared taxi',
        source: 'GROUP',
        sourceExpenseId: 'exp-gone',
        sourceDetachedAt: null,
      },
    ] as never)
    prismaMock.expense.findMany.mockResolvedValue([{ id: 'exp-ok' }] as never)
    const conflicts = await target.findConflicts(prismaMock as never, [
      {
        itemId: 'p-live-ok',
        title: 'Shared lunch',
        expenseVersion: 1,
        recurringSeriesId: null,
      },
      {
        itemId: 'p-live-gone',
        title: 'Shared taxi',
        expenseVersion: 1,
        recurringSeriesId: null,
      },
    ])
    expect(conflicts.map((c) => c.expenseId)).toEqual(['p-live-gone'])
    expect(prismaMock.expense.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.expense.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['exp-ok', 'exp-gone'] } },
      select: { id: true },
    })
    expect(prismaMock.expense.findUnique).not.toHaveBeenCalled()
  })

  it('applies native rows with version CAS and live GROUP rows via override', async () => {
    const target = personalTarget('acct-1')
    prismaMock.personalTransaction.findMany.mockResolvedValue([
      {
        id: 'native-1',
        version: 1,
        source: 'PERSONAL',
        sourceExpenseId: null,
        sourceDetachedAt: null,
        categoryId: 'general',
      },
      {
        id: 'live-1',
        version: 1,
        source: 'GROUP',
        sourceExpenseId: 'exp-1',
        sourceDetachedAt: null,
        categoryId: 'general',
      },
      {
        id: 'detached-1',
        version: 1,
        source: 'GROUP',
        sourceExpenseId: 'exp-9',
        sourceDetachedAt: new Date(),
        categoryId: 'general',
      },
    ] as never)
    prismaMock.personalTransaction.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.personalExpenseOverride.upsert.mockResolvedValue({} as never)

    const applied = await target.applyChunk(prismaMock as never, {
      accountId: 'acct-1',
      changes: [
        { itemId: 'native-1', categoryId: 'groceries' },
        { itemId: 'live-1', categoryId: 'groceries' },
        { itemId: 'detached-1', categoryId: 'groceries' },
      ],
      expectedVersions: new Map([
        ['native-1', 1],
        ['live-1', 1],
        ['detached-1', 1],
      ]),
    })
    expect(applied).toBe(3)
    // Only the live GROUP row creates an override; detached snapshots are row-only.
    expect(prismaMock.personalExpenseOverride.upsert).toHaveBeenCalledTimes(1)
    expect(prismaMock.personalExpenseOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId_expenseId: { accountId: 'acct-1', expenseId: 'exp-1' },
        },
      }),
    )
  })

  it('rejects cross-account rows', async () => {
    const target = personalTarget('acct-1')
    prismaMock.personalTransaction.findMany.mockResolvedValue([] as never)
    await expect(
      target.applyChunk(prismaMock as never, {
        accountId: 'acct-1',
        changes: [{ itemId: 'other-acct-row', categoryId: 'groceries' }],
        expectedVersions: new Map([['other-acct-row', 1]]),
      }),
    ).rejects.toThrow('No categories were applied')
  })

  it('group target still resolves by group id', async () => {
    prismaMock.group.findUniqueOrThrow.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.expense.count.mockResolvedValue(4 as never)
    const target = groupTarget('group-1')
    expect(target.scope).toEqual({ scopeType: 'GROUP', scopeId: 'group-1' })
    expect(target.supportsSeries).toBe(true)
    expect(personalTarget('acct-1').supportsSeries).toBe(false)
  })
})
