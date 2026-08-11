// organize-imports-ignore: test/mocks must register the Prisma mock first.
import '../../test/mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaMock } from '../../test/state'

const jobMocks = vi.hoisted(() => ({ sendJob: vi.fn() }))
const conversionMock = vi.hoisted(() => ({ resolveConversion: vi.fn() }))

vi.mock(import('@spliit/jobs'), async (importOriginal) => ({
  ...(await importOriginal()),
  sendJob: jobMocks.sendJob,
}))
vi.mock('../expense-conversion', () => conversionMock)
// Keep the unit test isolated from PostgreSQL: never start a real pg-boss
// client. `enqueueMaterialization` falls back to `getApiBossForWrite()`
// when no boss is injected, so stub it with a no-op client.
vi.mock('./boss', async (importOriginal) => ({
  ...(await importOriginal()),
  getApiBossForWrite: vi.fn(() => ({})),
}))

import {
  asDate,
  type MaterializationPayload,
  materializeRecurringExpense,
  parseCatchUpBatch,
} from './recurrence/materialize'

const date = (value: string) => new Date(`${value}T00:00:00.000Z`)
const template = {
  amount: 1000,
  title: 'Rent',
  description: null,
  paidByList: [{ ledgerParticipantId: 'p1', share: 10000 }],
  paidFor: [{ ledgerParticipantId: 'p1', share: 10000 }],
  items: [],
  itemizedRemainder: null,
  originalCurrency: null,
  conversionRate: null,
  conversionSource: null,
}

function series(overrides: Record<string, unknown> = {}) {
  return {
    id: 'series-1',
    ledgerId: 'ledger-1',
    creatorAccountId: null,
    timeZone: 'UTC',
    status: 'ACTIVE',
    occurrencesCreated: 0,
    nextOccurrenceDate: date('2026-07-20'),
    nextOccurrenceOrdinal: 1,
    anchorDate: date('2026-07-20'),
    frequency: 'DAILY',
    interval: 1,
    endType: 'INDEFINITE',
    occurrenceLimit: null,
    endDate: null,
    version: 1,
    template,
    catchUpBatch: null,
    ledger: {
      currencyCode: 'USD',
      group: { id: 'group-1', archived: false },
    },
    ...overrides,
  }
}

function setup(snapshot = series(), locked = snapshot) {
  prismaMock.recurringExpenseSeries.findUnique
    .mockResolvedValueOnce(snapshot as never)
    .mockResolvedValueOnce(locked as never)
    .mockResolvedValue(snapshot as never)
}

async function run(
  overrides: Record<string, unknown> = {},
  payload: MaterializationPayload = {
    seriesId: 'series-1',
    sequence: 1,
    occurrenceDate: '2026-07-20',
  },
) {
  const snapshot = series(overrides)
  setup(snapshot, snapshot)
  return materializeRecurringExpense(payload)
}

describe('recurring expense materialization', () => {
  beforeEach(() => {
    jobMocks.sendJob.mockReset()
    conversionMock.resolveConversion.mockResolvedValue({
      ledgerAmountMinor: 1000,
      inputAmountMinor: 1000,
      originalCurrency: 'USD',
      originalAmount: 1000,
      conversionRate: 1,
      conversionSource: 'CUSTOM',
    })
    prismaMock.expense.create.mockResolvedValue({
      id: 'expense-1',
      title: 'Rent',
      amount: 1000,
    } as never)
    prismaMock.activity.create.mockResolvedValue({
      id: 'activity-1',
      time: date('2026-07-20'),
    } as never)
  })
  afterEach(() => vi.useRealTimers())

  it('rejects a sequence mismatch pre-transaction', async () => {
    const result = await run({ occurrencesCreated: 2 })
    expect(result).toEqual({ created: false })
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })
  it('rejects a next occurrence date mismatch pre-transaction', async () => {
    const result = await run({ nextOccurrenceDate: date('2026-07-21') })
    expect(result).toEqual({ created: false })
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })
  it('rejects a COUNT occurrence beyond the limit pre-transaction', async () => {
    const result = await run(
      { occurrencesCreated: 2, occurrenceLimit: 2, endType: 'COUNT' },
      { seriesId: 'series-1', sequence: 3, occurrenceDate: '2026-07-20' },
    )
    expect(result).toEqual({ created: false })
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })
  it('rejects a DATE occurrence beyond the end date pre-transaction', async () => {
    const result = await run({ endType: 'DATE', endDate: date('2026-07-19') })
    expect(result).toEqual({ created: false })
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })
  it('reschedules an already-active job that fires before its updated wall time', async () => {
    vi.setSystemTime(new Date('2030-07-20T10:00:00.000Z'))
    const snapshot = series({
      anchorTimeMinutes: 15 * 60,
      nextOccurrenceDate: date('2030-07-20'),
    })
    setup(snapshot, snapshot)
    const upsert = vi.fn().mockResolvedValue({
      jobs: ['job-1'],
      updated: 1,
      inserted: 0,
    })

    await expect(
      materializeRecurringExpense(
        {
          seriesId: 'series-1',
          sequence: 1,
          occurrenceDate: '2030-07-20',
        },
        { upsert } as never,
      ),
    ).resolves.toEqual({ created: false })

    expect(upsert).toHaveBeenCalledWith(
      'recurring-expense.materialize',
      expect.objectContaining({
        seriesId: 'series-1',
        occurrenceDate: '2030-07-20',
      }),
      expect.objectContaining({
        startAfter: new Date('2030-07-20T15:00:00.000Z'),
      }),
    )
    expect(conversionMock.resolveConversion).not.toHaveBeenCalled()
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })
  it('returns the existing expense on an idempotent retry', async () => {
    const snapshot = series()
    setup(snapshot, snapshot)
    prismaMock.expense.findUnique.mockResolvedValue({ id: 'existing' } as never)
    await expect(
      materializeRecurringExpense({
        seriesId: 'series-1',
        sequence: 1,
        occurrenceDate: '2026-07-20',
      }),
    ).resolves.toEqual({ created: false, expenseId: 'existing' })
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })
  it('rejects a version conflict', async () => {
    setup(series(), series({ version: 2 }))
    await expect(
      materializeRecurringExpense({
        seriesId: 'series-1',
        sequence: 1,
        occurrenceDate: '2026-07-20',
      }),
    ).resolves.toEqual({ created: false })
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })
  it('materializes BY_SHARES template rows at their stored fixed units (scale-once)', async () => {
    // The template already stores fixed units (110 = 1.1 displayed share,
    // 50 = 0.5). Materialization must copy them verbatim — scaling happens
    // exactly once, at template creation from the serialized expense.
    const snapshot = series({
      template: {
        amount: 1000,
        title: 'Rent',
        description: null,
        paidBySplitMode: 'BY_SHARES',
        paidByList: [{ ledgerParticipantId: 'p1', shares: 110 }],
        splitMode: 'BY_SHARES',
        paidFor: [
          { ledgerParticipantId: 'p1', shares: 110 },
          { ledgerParticipantId: 'p2', shares: 50 },
        ],
        items: [],
        itemizedRemainder: null,
        originalCurrency: null,
        conversionRate: null,
        conversionSource: null,
      },
    })
    setup(snapshot, snapshot)

    await materializeRecurringExpense({
      seriesId: 'series-1',
      sequence: 1,
      occurrenceDate: '2026-07-20',
    })

    expect(prismaMock.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          splitMode: 'BY_SHARES',
          paidBySplitMode: 'BY_SHARES',
          paidFor: {
            createMany: {
              data: [
                { ledgerParticipantId: 'p1', shares: 110 },
                { ledgerParticipantId: 'p2', shares: 50 },
              ],
            },
          },
          paidByList: {
            createMany: { data: [{ ledgerParticipantId: 'p1', shares: 110 }] },
          },
        }),
      }),
    )
  })

  it('completes in-transaction COUNT termination', async () => {
    const snapshot = series({ occurrenceLimit: 0, endType: 'COUNT' })
    setup(series(), snapshot)
    await expect(
      materializeRecurringExpense({
        seriesId: 'series-1',
        sequence: 1,
        occurrenceDate: '2026-07-20',
      }),
    ).resolves.toEqual({ created: false })
    expect(prismaMock.recurringExpenseSeries.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'COMPLETED' } }),
    )
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
    expect(jobMocks.sendJob).not.toHaveBeenCalled()
  })
  it('completes in-transaction DATE termination', async () => {
    const snapshot = series({ endType: 'DATE', endDate: date('2026-07-19') })
    setup(series(), snapshot)
    await expect(
      materializeRecurringExpense({
        seriesId: 'series-1',
        sequence: 1,
        occurrenceDate: '2026-07-20',
      }),
    ).resolves.toEqual({ created: false })
    expect(prismaMock.recurringExpenseSeries.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'COMPLETED' } }),
    )
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })
  it('rejects an ordinal/date inconsistency', async () => {
    const snapshot = series({
      nextOccurrenceDate: date('2026-07-20'),
      anchorDate: date('2026-07-21'),
    })
    setup(snapshot, snapshot)
    await expect(
      materializeRecurringExpense({
        seriesId: 'series-1',
        sequence: 1,
        occurrenceDate: '2026-07-20',
      }),
    ).resolves.toEqual({ created: false })
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })
  it('pauses when the group is archived', async () => {
    const snapshot = series({
      ledger: { currencyCode: 'USD', group: { id: 'group-1', archived: true } },
    })
    setup(snapshot, snapshot)
    await expect(
      materializeRecurringExpense({
        seriesId: 'series-1',
        sequence: 1,
        occurrenceDate: '2026-07-20',
      }),
    ).resolves.toEqual({ created: false })
    expect(prismaMock.recurringExpenseSeries.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'PAUSED',
          catchUpBatch: null,
          version: { increment: 1 },
        },
      }),
    )
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })
  it('materializes a valid occurrence and enqueues the next one', async () => {
    const result = await run()
    expect(prismaMock.expense.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.recurringExpenseSeries.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          occurrencesCreated: 1,
          nextOccurrenceOrdinal: 2,
          version: { increment: 1 },
        }),
      }),
    )
    expect(jobMocks.sendJob).toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({ created: true, expenseId: 'expense-1' }),
    )
  })
  it('does not enqueue after COUNT completion', async () => {
    const result = await run(
      {
        endType: 'COUNT',
        occurrenceLimit: 1,
        nextOccurrenceDate: date('2026-07-20'),
        nextOccurrenceOrdinal: 1,
      },
      {
        seriesId: 'series-1',
        sequence: 1,
        occurrenceDate: '2026-07-20',
      },
    )
    expect(result).toEqual(
      expect.objectContaining({ created: true, seriesStatus: 'COMPLETED' }),
    )
    expect(jobMocks.sendJob).not.toHaveBeenCalled()
  })
  it('emits a catch-up summary when an open batch crosses its cutoff', async () => {
    vi.setSystemTime(new Date('2026-07-20T00:00:00Z'))
    const result = await run({
      catchUpBatch: {
        id: 'batch',
        startDate: '2026-07-19',
        count: 1,
        dueThrough: '2026-07-19',
      },
    })
    expect(result.catchUpSummary).toEqual(expect.objectContaining({ count: 2 }))
  })
  it('does not emit a catch-up summary for a batch count below two', async () => {
    const result = await run({
      catchUpBatch: {
        id: 'batch',
        startDate: '2026-07-20',
        count: 0,
        dueThrough: '2026-07-20',
      },
    })
    expect(result.catchUpSummary).toBeUndefined()
  })
  it('parses catch-up batches defensively', () => {
    expect(parseCatchUpBatch(null)).toBeNull()
    expect(parseCatchUpBatch('x')).toBeNull()
    expect(parseCatchUpBatch({ startDate: '2026-01-01', count: 1 })).toBeNull()
    expect(
      parseCatchUpBatch({ id: 'x', startDate: '2026-01-01', count: 1.2 }),
    ).toBeNull()
    expect(
      parseCatchUpBatch({ id: 'x', startDate: '2026-01-01', count: -1 }),
    ).toBeNull()
    expect(
      parseCatchUpBatch({
        id: 'x',
        startDate: '2026-01-01',
        count: 1,
        dueThrough: '2026-01-02',
        mode: 'bad',
      }),
    ).toEqual({
      id: 'x',
      startDate: '2026-01-01',
      count: 1,
      dueThrough: '2026-01-02',
      mode: undefined,
    })
  })
  it('rejects invalid dates and parses valid ISO dates at UTC midnight', () => {
    expect(() => asDate('not-a-date')).toThrow(RangeError)
    expect(asDate('2026-07-20').toISOString()).toBe('2026-07-20T00:00:00.000Z')
  })
})
