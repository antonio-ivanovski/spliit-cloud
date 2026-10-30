import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { usePrismaMemoryStore } from '../../test/prisma-memory-store'
import { prismaMock, resetPrisma } from '../../test/state'

vi.mock('../api/boss', async (importOriginal) => ({
  ...(await importOriginal()),
  getApiBossForWrite: vi.fn(async () => {
    throw new Error('Background jobs are disabled')
  }),
}))

import {
  materializePersonalRecurringSeries,
  reconcileDuePersonalRecurringSeries,
} from './recurring-materialize'

const ACCOUNT = 'acct-mat'

function seriesRow(overrides: Record<string, unknown> = {}) {
  const today = new Date().toISOString().slice(0, 10)
  return {
    id: 'series-mat',
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    accountId: ACCOUNT,
    timeZone: 'UTC',
    frequency: 'DAILY',
    interval: 1,
    anchorDate: new Date(`${today}T00:00:00.000Z`),
    anchorSequence: 1,
    nextOccurrenceDate: new Date(`${today}T00:00:00.000Z`),
    nextOccurrenceOrdinal: 1,
    endType: 'INDEFINITE',
    occurrenceLimit: null,
    endDate: null,
    occurrencesCreated: 0,
    status: 'ACTIVE',
    kind: 'EXPENSE',
    amount: 100,
    currencyCode: 'USD',
    categoryId: 'general',
    title: 'Daily',
    note: null,
    version: 1,
    ...overrides,
  }
}

function seed(series: Record<string, unknown>) {
  resetPrisma()
  usePrismaMemoryStore({
    personalProfile: [
      {
        accountId: ACCOUNT,
        currencyCode: 'USD',
        timeZone: 'UTC',
        sharedEnabled: false,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    ],
    personalRecurringSeries: [series],
    personalTransaction: [],
  })
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

describe('personal recurring materializer', () => {
  beforeEach(() => {
    seed(seriesRow())
  })

  it('materializes one flat PERSONAL row and advances the cursor', async () => {
    const result = await materializePersonalRecurringSeries({
      seriesId: 'series-mat',
      sequence: 1,
      occurrenceDate: todayIso(),
    })
    expect(result.created).toBe(true)

    const rows = await prismaMock.personalTransaction.findMany({
      where: { accountId: ACCOUNT },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      source: 'PERSONAL',
      amount: 100,
      currencyCode: 'USD',
      personalRecurringSeriesId: 'series-mat',
      recurrenceSequence: 1,
      version: 1,
    })

    const series = await prismaMock.personalRecurringSeries.findUnique({
      where: { id: 'series-mat' },
    })
    expect(series).toMatchObject({
      occurrencesCreated: 1,
      nextOccurrenceOrdinal: 2,
      status: 'ACTIVE',
    })

    // No group side-effects: no activities, no webhooks, no budgets.
    expect(prismaMock.activity.create).not.toHaveBeenCalled()
    expect(prismaMock.personalBudget.findMany).not.toHaveBeenCalled()
  })

  it('is idempotent on duplicate delivery', async () => {
    const payload = {
      seriesId: 'series-mat',
      sequence: 1,
      occurrenceDate: todayIso(),
    }
    const first = await materializePersonalRecurringSeries(payload)
    expect(first.created).toBe(true)
    const second = await materializePersonalRecurringSeries(payload)
    expect(second.created).toBe(false)
    const rows = await prismaMock.personalTransaction.findMany({
      where: { accountId: ACCOUNT },
    })
    expect(rows).toHaveLength(1)
  })

  it('rejects sequence and date mismatches without writing', async () => {
    const badSequence = await materializePersonalRecurringSeries({
      seriesId: 'series-mat',
      sequence: 2,
      occurrenceDate: todayIso(),
    })
    expect(badSequence.created).toBe(false)

    const tomorrow = new Date()
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const badDate = await materializePersonalRecurringSeries({
      seriesId: 'series-mat',
      sequence: 1,
      occurrenceDate: tomorrow.toISOString().slice(0, 10),
    })
    expect(badDate.created).toBe(false)

    const rows = await prismaMock.personalTransaction.findMany({
      where: { accountId: ACCOUNT },
    })
    expect(rows).toHaveLength(0)
  })

  it('completes a COUNT series on its last occurrence', async () => {
    seed(seriesRow({ endType: 'COUNT', occurrenceLimit: 1 }))
    const result = await materializePersonalRecurringSeries({
      seriesId: 'series-mat',
      sequence: 1,
      occurrenceDate: todayIso(),
    })
    expect(result.created).toBe(true)
    const series = await prismaMock.personalRecurringSeries.findUnique({
      where: { id: 'series-mat' },
    })
    expect(series?.status).toBe('COMPLETED')
  })

  it('skips paused and terminal series', async () => {
    seed(seriesRow({ status: 'PAUSED' }))
    const paused = await materializePersonalRecurringSeries({
      seriesId: 'series-mat',
      sequence: 1,
      occurrenceDate: todayIso(),
    })
    expect(paused.created).toBe(false)

    seed(seriesRow({ status: 'CANCELLED' }))
    const cancelled = await materializePersonalRecurringSeries({
      seriesId: 'series-mat',
      sequence: 1,
      occurrenceDate: todayIso(),
    })
    expect(cancelled.created).toBe(false)
  })

  it('reconciles due series and pages', async () => {
    const sendCalls: Array<{ name: string; payload: unknown }> = []
    const fakeBoss = {
      send: vi.fn(async (name: string, payload: unknown) => {
        sendCalls.push({ name, payload })
        return 'job-1'
      }),
      findJobs: vi.fn(async () => []),
    }
    const result = await reconcileDuePersonalRecurringSeries(
      fakeBoss as never,
      {},
    )
    expect(result.scanned).toBe(1)
    expect(result.enqueued).toBe(1)
    expect(sendCalls[0]?.name).toBe('personal-recurring.materialize')
  })

  it('returns early when the locked row version changed', async () => {
    const row = seriesRow()
    // Snapshot reads version 1; the row locked in the transaction is already
    // at version 2 (concurrent skip/resume/update won the race).
    const snapshot = { ...row, version: 1 }
    const locked = { ...row, version: 2 }
    resetPrisma()
    const findUnique = prismaMock.personalRecurringSeries
      .findUnique as unknown as ReturnType<typeof vi.fn>
    findUnique
      .mockResolvedValueOnce(snapshot as never)
      .mockResolvedValueOnce(locked as never)
    prismaMock.personalTransaction.findUnique.mockResolvedValue(null as never)
    const result = await materializePersonalRecurringSeries({
      seriesId: 'series-mat',
      sequence: 1,
      occurrenceDate: todayIso(),
    })
    expect(result.created).toBe(false)
    expect(prismaMock.personalTransaction.create).not.toHaveBeenCalled()
  })

  it('enqueues the next slot with startAfter when it lies in the future', async () => {
    const sendCalls: Array<{
      name: string
      payload: unknown
      options: unknown
    }> = []
    const fakeBoss = {
      send: vi.fn(async (name: string, payload: unknown, options: unknown) => {
        sendCalls.push({ name, payload, options })
        return 'job-1'
      }),
      findJobs: vi.fn(async () => []),
    }
    const result = await materializePersonalRecurringSeries(
      {
        seriesId: 'series-mat',
        sequence: 1,
        occurrenceDate: todayIso(),
      },
      fakeBoss as never,
    )
    expect(result.created).toBe(true)
    const nextCall = sendCalls.find(
      (call) => call.name === 'personal-recurring.materialize',
    )
    expect(nextCall).toBeDefined()
    expect(nextCall?.payload).toMatchObject({ sequence: 2 })
    expect(nextCall?.options).toMatchObject({
      singletonKey: expect.stringContaining(':2:'),
    })
    // Next daily occurrence is tomorrow, so the job is delayed until then.
    expect(nextCall?.options).toMatchObject({
      startAfter: expect.any(Date),
    })
  })

  it('skips a DLQ-parked series instead of re-enqueueing it', async () => {
    const fakeBoss = {
      send: vi.fn(async () => 'job-1'),
      findJobs: vi.fn(async () => [
        {
          sourceName: 'personal-recurring.materialize',
          data: {
            seriesId: 'series-mat',
            sequence: 1,
            occurrenceDate: todayIso(),
          },
        },
      ]),
    }
    const result = await reconcileDuePersonalRecurringSeries(
      fakeBoss as never,
      {},
    )
    expect(result.scanned).toBe(1)
    expect(result.enqueued).toBe(0)
    expect(fakeBoss.send).not.toHaveBeenCalled()
  })
})
