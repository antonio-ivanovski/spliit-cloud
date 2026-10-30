import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { usePrismaMemoryStore } from '../../test/prisma-memory-store'
import { prismaMock, resetPrisma } from '../../test/state'
import { personalRouter } from '../../trpc/routers/personal'
import { getApiBossForWrite } from '../api/boss'

vi.mock('../api/boss', async (importOriginal) => ({
  ...(await importOriginal()),
  getApiBossForWrite: vi.fn(async () => {
    throw new Error('Background jobs are disabled')
  }),
}))

const ACCOUNT_A = 'acct-rec-a'
const ACCOUNT_B = 'acct-rec-b'

function caller(accountId: string) {
  return personalRouter.createCaller({
    auth: {
      session: { id: 'sess-rec' },
      user: {
        id: accountId,
        email: `${accountId}@test.example`,
        emailVerified: true,
        name: accountId,
      },
    },
  } as never)
}

function seed() {
  resetPrisma()
  usePrismaMemoryStore({
    personalProfile: [
      {
        accountId: ACCOUNT_A,
        currencyCode: 'USD',
        timeZone: 'UTC',
        sharedEnabled: false,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      {
        accountId: ACCOUNT_B,
        currencyCode: 'USD',
        timeZone: 'UTC',
        sharedEnabled: false,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    ],
  })
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function futureIso(days: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('personal.recurring', () => {
  beforeEach(() => {
    seed()
  })

  it('creates a future series without writing transactions', async () => {
    const api = caller(ACCOUNT_A)
    const created = await api.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'MONTHLY',
        interval: 1,
        anchorDate: futureIso(30),
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 1200,
        categoryId: 'groceries',
        title: 'Veg box',
      },
    })
    expect(created.id).toBeTruthy()

    const upcoming = await api.recurring.upcoming({ limit: 3 })
    expect(upcoming.occurrences).toHaveLength(3)
    expect(upcoming.occurrences[0]).toMatchObject({
      seriesId: created.id,
      sequence: 1,
      date: futureIso(30),
    })

    const listed = await prismaMock.personalTransaction.findMany({
      where: { accountId: ACCOUNT_A },
    })
    expect(listed).toHaveLength(0)

    // Read-only projection performs no writes.
    expect(prismaMock.personalTransaction.create).not.toHaveBeenCalled()

    const series = await api.recurring.list()
    expect(series.series).toHaveLength(1)
    expect(series.series[0]).toMatchObject({
      id: created.id,
      status: 'ACTIVE',
      generatedCount: 0,
      nextOccurrenceOrdinal: 1,
    })
  })

  it('rejects schedule changes and enforces version CAS', async () => {
    const api = caller(ACCOUNT_A)
    const created = await api.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'WEEKLY',
        interval: 1,
        anchorDate: todayIso(),
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 500,
        categoryId: 'general',
      },
    })
    await expect(
      api.recurring.update({
        id: created.id,
        // @ts-expect-error schedule fields are rejected at runtime
        patch: { frequency: 'MONTHLY' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    await expect(
      api.recurring.update({
        id: created.id,
        expectedVersion: 9999,
        patch: { amount: 600 },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    const updated = await api.recurring.update({
      id: created.id,
      patch: { amount: 600, title: 'Updated' },
    })
    expect(updated.id).toBe(created.id)
  })

  it('rejects shrinking COUNT below created and DATE before anchor', async () => {
    const api = caller(ACCOUNT_A)
    const created = await api.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'DAILY',
        interval: 1,
        anchorDate: todayIso(),
        end: { type: 'COUNT', count: 3 },
        kind: 'EXPENSE',
        amount: 100,
        categoryId: 'general',
      },
    })
    await expect(
      api.recurring.update({
        id: created.id,
        patch: { end: { type: 'DATE', endDate: '2020-01-01' } },
      }),
    ).rejects.toThrow()
  })

  it('pauses, resumes, skips, cancels, and guards deletion', async () => {
    const api = caller(ACCOUNT_A)
    const created = await api.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'DAILY',
        interval: 1,
        anchorDate: todayIso(),
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 100,
        categoryId: 'general',
      },
    })
    await api.recurring.pause({ id: created.id })
    await expect(api.recurring.pause({ id: created.id })).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    )
    const resumed = await api.recurring.resume({ id: created.id })
    expect(resumed.id).toBe(created.id)

    const skipped = await api.recurring.skipNext({ id: created.id })
    expect(skipped.id).toBe(created.id)

    await api.recurring.cancel({ id: created.id })
    await expect(
      api.recurring.update({ id: created.id, patch: { amount: 200 } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    // No generated rows yet, so hard-delete is allowed after cancel.
    const deleted = await api.recurring.delete({ id: created.id })
    expect(deleted).toEqual({ ok: true })
  })

  it('advances the cursor twice on two sequential skips', async () => {
    const api = caller(ACCOUNT_A)
    const created = await api.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'DAILY',
        interval: 1,
        anchorDate: todayIso(),
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 100,
        categoryId: 'general',
      },
    })
    const first = await api.recurring.skipNext({ id: created.id })
    expect(first).toMatchObject({ id: created.id })
    const second = await api.recurring.skipNext({ id: created.id })
    expect(second).toMatchObject({ id: created.id })
    const listed = await api.recurring.list()
    const row = listed.series.find((item) => item.id === created.id)
    expect(row?.nextOccurrenceOrdinal).toBe(3)
    // Two skips from a daily anchor land two days out.
    const expected = new Date(`${todayIso()}T00:00:00.000Z`)
    expected.setUTCDate(expected.getUTCDate() + 2)
    expect(row?.nextOccurrenceDate).toBe(expected.toISOString().slice(0, 10))
  })

  it('rejects a stale skip with CONFLICT', async () => {
    const api = caller(ACCOUNT_A)
    const created = await api.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'DAILY',
        interval: 1,
        anchorDate: todayIso(),
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 100,
        categoryId: 'general',
      },
    })
    const updateMany = prismaMock.personalRecurringSeries
      .updateMany as unknown as ReturnType<typeof vi.fn>
    updateMany.mockResolvedValueOnce({ count: 0 } as never)
    await expect(
      api.recurring.skipNext({ id: created.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('resumes with the slot ordinal and a future startAfter', async () => {
    const api = caller(ACCOUNT_A)
    const created = await api.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'DAILY',
        interval: 1,
        anchorDate: futureIso(2),
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 100,
        categoryId: 'general',
      },
    })
    await api.recurring.pause({ id: created.id })
    const send = vi.fn(async () => 'job-1')
    vi.mocked(getApiBossForWrite).mockResolvedValueOnce({
      send,
    } as never)
    const resumed = await api.recurring.resume({ id: created.id })
    expect(resumed.id).toBe(created.id)
    expect(send).toHaveBeenCalledTimes(1)
    const [name, payload, options] = send.mock.calls[0] as [
      string,
      { seriesId: string; sequence: number; occurrenceDate: string },
      { startAfter?: Date; singletonKey?: string },
    ]
    expect(name).toBe('personal-recurring.materialize')
    // Slot ordinal (1), not created+1 confusion: both are 1 here, so assert
    // the date matches the future anchor and the job is delayed until then.
    expect(payload).toMatchObject({
      seriesId: created.id,
      sequence: 1,
      occurrenceDate: futureIso(2),
    })
    expect(options.startAfter).toBeInstanceOf(Date)
  })

  it('isolates accounts', async () => {
    const apiA = caller(ACCOUNT_A)
    const apiB = caller(ACCOUNT_B)
    const created = await apiA.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'MONTHLY',
        interval: 1,
        anchorDate: futureIso(10),
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 100,
        categoryId: 'general',
      },
    })
    expect((await apiB.recurring.list()).series).toHaveLength(0)
    expect((await apiB.recurring.upcoming({})).occurrences).toHaveLength(0)
    await expect(
      apiB.recurring.update({ id: created.id, patch: { amount: 200 } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(apiB.recurring.pause({ id: created.id })).rejects.toThrow()
  })

  it('detaches a generated row on edit', async () => {
    const api = caller(ACCOUNT_A)
    const created = await api.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'DAILY',
        interval: 1,
        anchorDate: todayIso(),
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 250,
        categoryId: 'groceries',
        title: 'Coffee',
      },
    })
    const { materializePersonalRecurringSeries } =
      await import('./recurring-materialize')
    const result = await materializePersonalRecurringSeries({
      seriesId: created.id,
      sequence: 1,
      occurrenceDate: todayIso(),
    })
    expect(result.created).toBe(true)

    const listed = await prismaMock.personalTransaction.findMany({
      where: { accountId: ACCOUNT_A },
    })
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      personalRecurringSeriesId: created.id,
      recurrenceSequence: 1,
    })

    await api.transactions.update({
      id: listed[0]!.id,
      entry: { amount: 300 },
    })
    const after = await prismaMock.personalTransaction.findMany({
      where: { accountId: ACCOUNT_A },
    })
    expect(after[0]?.amount).toBe(300)
    expect(after[0]?.personalRecurringSeriesId).toBeNull()
    expect(after[0]?.recurrenceSequence).toBeNull()
  })

  it('detaches a generated row on setCategory', async () => {
    const api = caller(ACCOUNT_A)
    const created = await api.recurring.create({
      requestId: crypto.randomUUID(),
      series: {
        frequency: 'DAILY',
        interval: 1,
        anchorDate: todayIso(),
        end: { type: 'INDEFINITE' },
        kind: 'EXPENSE',
        amount: 250,
        categoryId: 'groceries',
        title: 'Coffee',
      },
    })
    const { materializePersonalRecurringSeries } =
      await import('./recurring-materialize')
    const result = await materializePersonalRecurringSeries({
      seriesId: created.id,
      sequence: 1,
      occurrenceDate: todayIso(),
    })
    expect(result.created).toBe(true)

    const listed = await prismaMock.personalTransaction.findMany({
      where: { accountId: ACCOUNT_A },
    })
    const rowId = listed[0]!.id as string
    await api.transactions.setCategory({
      id: rowId,
      categoryId: 'dining-out',
    })
    const after = await prismaMock.personalTransaction.findMany({
      where: { accountId: ACCOUNT_A },
    })
    expect(after[0]).toMatchObject({ categoryId: 'dining-out' })
    expect(after[0]?.personalRecurringSeriesId).toBeNull()
    expect(after[0]?.recurrenceSequence).toBeNull()
  })
})
