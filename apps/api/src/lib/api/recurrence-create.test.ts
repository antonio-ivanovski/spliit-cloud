// organize-imports-ignore: test/mocks must register the Prisma mock first.
import '../../test/mocks'
import { prismaMock } from '../../test/state'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecurrenceConfig, RecurringExpenseTemplate } from '@spliit/domain'

const jobMocks = vi.hoisted(() => ({
  sendJob: vi.fn(),
  hasDeadLetteredMaterialization: vi.fn(),
}))

vi.mock(import('@spliit/jobs'), async (importOriginal) => ({
  ...(await importOriginal()),
  sendJob: jobMocks.sendJob,
  hasDeadLetteredMaterialization: jobMocks.hasDeadLetteredMaterialization,
}))

import { createSeriesForExpense } from './recurrence-series'

const monthlyIndefinite: RecurrenceConfig = {
  frequency: 'MONTHLY',
  interval: 1,
  end: { type: 'INDEFINITE' },
}

const monthlyDate: RecurrenceConfig = {
  frequency: 'MONTHLY',
  interval: 1,
  end: { type: 'DATE', endDate: new Date('2026-06-01T00:00:00.000Z') },
}

const monthlyCount: RecurrenceConfig = {
  frequency: 'MONTHLY',
  interval: 1,
  end: { type: 'COUNT', count: 5 },
}

const template: RecurringExpenseTemplate = {
  title: 'Rent',
  categoryId: 'general',
  amount: 1000,
  originalAmount: null,
  originalCurrency: null,
  conversionRate: null,
  conversionSource: null,
  paidBySplitMode: 'BY_AMOUNT',
  paidByList: [{ ledgerParticipantId: 'p1', shares: 1000 }],
  paidFor: [{ ledgerParticipantId: 'p1', shares: 1 }],
  splitMode: 'EVENLY',
  isReimbursement: false,
  notes: null,
  items: [],
  itemizedRemainder: null,
}

const boss = {} as never

describe('createSeriesForExpense', () => {
  beforeEach(() => {
    jobMocks.sendJob.mockReset()
    jobMocks.hasDeadLetteredMaterialization.mockReset()
  })

  it('creates a COMPLETED series without enqueueing when the DATE end falls on the anchor', async () => {
    const anchor = new Date('2026-06-01T00:00:00.000Z')
    prismaMock.recurringExpenseSeries.create.mockResolvedValue({
      id: 'series-completed',
    } as never)

    await createSeriesForExpense({
      tx: prismaMock,
      seriesId: 'series-completed',
      ledgerId: 'ledger-1',
      creatorAccountId: 'acct-1',
      anchorDate: anchor,
      config: monthlyDate,
      template,
      boss,
    })

    expect(prismaMock.recurringExpenseSeries.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          endType: 'DATE',
          endDate: monthlyDate.end.endDate,
          occurrencesCreated: 1,
          nextOccurrenceOrdinal: 2,
          nextOccurrenceDate: new Date('2026-07-01T00:00:00.000Z'),
        }),
      }),
    )
    expect(jobMocks.sendJob).not.toHaveBeenCalled()
  })

  it('creates an ACTIVE series and enqueues the next occurrence for an INDEFINITE config', async () => {
    const anchor = new Date('2026-01-01T00:00:00.000Z')
    prismaMock.recurringExpenseSeries.create.mockResolvedValue({
      id: 'series-active',
    } as never)

    await createSeriesForExpense({
      tx: prismaMock,
      seriesId: 'series-active',
      ledgerId: 'ledger-1',
      creatorAccountId: 'acct-1',
      anchorDate: anchor,
      config: monthlyIndefinite,
      template,
      boss,
    })

    expect(prismaMock.recurringExpenseSeries.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ACTIVE',
          endType: 'INDEFINITE',
          occurrenceLimit: null,
          endDate: null,
          occurrencesCreated: 1,
          nextOccurrenceOrdinal: 2,
          nextOccurrenceDate: new Date('2026-02-01T00:00:00.000Z'),
        }),
      }),
    )
    expect(jobMocks.sendJob).toHaveBeenCalledTimes(1)
    expect(jobMocks.sendJob).toHaveBeenCalledWith(
      expect.anything(),
      'recurring-expense.materialize',
      expect.objectContaining({
        seriesId: 'series-active',
        sequence: 2,
        occurrenceDate: '2026-02-01',
      }),
      expect.objectContaining({ db: expect.anything() }),
    )
  })

  it('stores backfill/import overrides verbatim and enqueues sequence = occurrencesCreated + 1', async () => {
    const anchor = new Date('2026-01-01T00:00:00.000Z')
    const nextDate = new Date('2026-08-19T00:00:00.000Z')
    prismaMock.recurringExpenseSeries.create.mockResolvedValue({
      id: 'series-import',
    } as never)

    await createSeriesForExpense({
      tx: prismaMock,
      seriesId: 'series-import',
      ledgerId: 'ledger-1',
      creatorAccountId: 'acct-1',
      anchorDate: anchor,
      config: monthlyIndefinite,
      template,
      boss,
      occurrencesCreated: 5,
      nextOccurrenceDate: nextDate,
      nextOccurrenceOrdinal: 17,
    })

    expect(prismaMock.recurringExpenseSeries.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ACTIVE',
          occurrencesCreated: 5,
          nextOccurrenceOrdinal: 17,
          nextOccurrenceDate: nextDate,
        }),
      }),
    )
    expect(jobMocks.sendJob).toHaveBeenCalledTimes(1)
    expect(jobMocks.sendJob).toHaveBeenCalledWith(
      expect.anything(),
      'recurring-expense.materialize',
      expect.objectContaining({
        seriesId: 'series-import',
        sequence: 6,
        occurrenceDate: '2026-08-19',
      }),
      expect.anything(),
    )
  })

  it('persists a provided catchUpBatch on the created row', async () => {
    const anchor = new Date('2026-01-01T00:00:00.000Z')
    prismaMock.recurringExpenseSeries.create.mockResolvedValue({
      id: 'series-catchup',
    } as never)

    const catchUpBatch = {
      id: 'recurring-catchup:series-catchup:2026-01-01',
      startDate: '2026-01-01',
      count: 0,
      mode: 'INITIAL_CREATION' as const,
      dueThrough: '2026-01-15',
    }

    await createSeriesForExpense({
      tx: prismaMock,
      seriesId: 'series-catchup',
      ledgerId: 'ledger-1',
      creatorAccountId: 'acct-1',
      anchorDate: anchor,
      config: monthlyCount,
      template,
      boss,
      catchUpBatch,
    })

    expect(prismaMock.recurringExpenseSeries.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ACTIVE',
          catchUpBatch,
        }),
      }),
    )
  })

  it('defaults the next cursor to ordinal 2 with the calculated second occurrence date', async () => {
    const anchor = new Date('2026-01-01T00:00:00.000Z')
    prismaMock.recurringExpenseSeries.create.mockResolvedValue({
      id: 'series-defaults',
    } as never)

    await createSeriesForExpense({
      tx: prismaMock,
      seriesId: 'series-defaults',
      ledgerId: 'ledger-1',
      creatorAccountId: 'acct-1',
      anchorDate: anchor,
      config: monthlyIndefinite,
      template,
      boss,
    })

    const call = prismaMock.recurringExpenseSeries.create.mock
      .calls[0]?.[0] as {
      data: Record<string, unknown>
    }
    expect(call.data.nextOccurrenceOrdinal).toBe(2)
    expect(call.data.occurrencesCreated).toBe(1)
    expect((call.data.nextOccurrenceDate as Date).toISOString()).toBe(
      new Date('2026-02-01T00:00:00.000Z').toISOString(),
    )
  })
})
