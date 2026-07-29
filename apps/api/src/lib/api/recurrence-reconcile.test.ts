// organize-imports-ignore: test/mocks must register the Prisma mock first.
import '../../test/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prisma$Transaction, prismaMock } from '../../test/state'

const jobMocks = vi.hoisted(() => ({
  hasDeadLetteredMaterialization: vi.fn(),
  sendJob: vi.fn(),
}))

vi.mock(import('@spliit/jobs'), async (importOriginal) => ({
  ...(await importOriginal()),
  hasDeadLetteredMaterialization: jobMocks.hasDeadLetteredMaterialization,
  sendJob: jobMocks.sendJob,
}))

import { reconcileDueRecurringExpenses } from './recurrence-series'

describe('recurring expense reconciliation', () => {
  beforeEach(() => {
    jobMocks.hasDeadLetteredMaterialization.mockReset()
    jobMocks.sendJob.mockReset()
  })

  it('does not re-enqueue a due occurrence already parked in the DLQ', async () => {
    prismaMock.recurringExpenseSeries.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'series-1',
          occurrencesCreated: 1,
          nextOccurrenceDate: new Date('2026-07-22T00:00:00Z'),
          timeZone: 'UTC',
        },
      ] as never)
    jobMocks.hasDeadLetteredMaterialization.mockResolvedValue(true)
    const boss = {} as never

    await reconcileDueRecurringExpenses(boss)

    expect(jobMocks.hasDeadLetteredMaterialization).toHaveBeenCalledWith(boss, {
      seriesId: 'series-1',
      sequence: 2,
      occurrenceDate: '2026-07-22',
    })
    expect(jobMocks.sendJob).not.toHaveBeenCalled()
  })

  it('reconciles a positive-offset occurrence after its local afternoon', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-23T01:10:00.000Z'))
    prismaMock.recurringExpenseSeries.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'series-kiritimati',
          occurrencesCreated: 1,
          nextOccurrenceDate: new Date('2026-07-23T00:00:00.000Z'),
          timeZone: 'Pacific/Kiritimati',
        },
      ] as never)
    jobMocks.hasDeadLetteredMaterialization.mockResolvedValue(false)

    await expect(reconcileDueRecurringExpenses({} as never)).resolves.toBe(1)
    expect(jobMocks.sendJob).toHaveBeenCalledWith(
      expect.anything(),
      'recurring-expense.materialize',
      {
        seriesId: 'series-kiritimati',
        sequence: 2,
        occurrenceDate: '2026-07-23',
      },
      expect.objectContaining({
        singletonKey: 'series-kiritimati:2:2026-07-23',
      }),
    )
    vi.useRealTimers()
  })

  it('bounds reconciliation pages and schedules a continuation', async () => {
    const due = Array.from({ length: 250 }, (_, index) => ({
      id: `series-${index}`,
      timeZone: 'UTC',
      occurrencesCreated: 1,
      nextOccurrenceDate: new Date('2026-07-22T00:00:00Z'),
    }))
    prismaMock.recurringExpenseSeries.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(due as never)
    jobMocks.hasDeadLetteredMaterialization.mockResolvedValue(false)

    await reconcileDueRecurringExpenses({} as never)

    // One materialization send per row, plus a bounded-page continuation.
    expect(jobMocks.sendJob).toHaveBeenCalledTimes(251)
    expect(jobMocks.sendJob).toHaveBeenLastCalledWith(
      expect.anything(),
      'recurring-expense.reconcile',
      { cursor: 'series-249' },
      expect.objectContaining({
        singletonKey: 'recurring-expense-reconciliation:series-249',
      }),
    )
  })

  it('continues reconciling the remaining series when enqueue throws for one', async () => {
    const due = [
      {
        id: 'series-a',
        timeZone: 'UTC',
        occurrencesCreated: 1,
        nextOccurrenceDate: new Date('2026-07-22T00:00:00Z'),
      },
      {
        id: 'series-b',
        timeZone: 'UTC',
        occurrencesCreated: 1,
        nextOccurrenceDate: new Date('2026-07-22T00:00:00Z'),
      },
      {
        id: 'series-c',
        timeZone: 'UTC',
        occurrencesCreated: 1,
        nextOccurrenceDate: new Date('2026-07-22T00:00:00Z'),
      },
    ]
    prismaMock.recurringExpenseSeries.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(due as never)
    jobMocks.hasDeadLetteredMaterialization.mockResolvedValue(false)
    jobMocks.sendJob
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw new Error('rejected by a queue policy')
      })
      .mockResolvedValueOnce(undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(reconcileDueRecurringExpenses({} as never)).resolves.toBe(3)

    // Materialization send was attempted for all three series, but only the
    // two non-throwing ones resolved successfully.
    expect(jobMocks.sendJob).toHaveBeenCalledTimes(3)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('series-b'))
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('rejected by a queue policy'),
    )
    warnSpy.mockRestore()
  })

  it('swallows a singleton collision on the pagination continuation', async () => {
    const due = Array.from({ length: 250 }, (_, index) => ({
      id: `series-${index}`,
      timeZone: 'UTC',
      occurrencesCreated: 1,
      nextOccurrenceDate: new Date('2026-07-22T00:00:00Z'),
    }))
    prismaMock.recurringExpenseSeries.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(due as never)
    jobMocks.hasDeadLetteredMaterialization.mockResolvedValue(false)
    // All materialization sends succeed; the continuation send collides.
    jobMocks.sendJob.mockImplementation(((_boss, name) => {
      if (name === 'recurring-expense.reconcile') {
        throw new Error('rejected by a queue policy')
      }
      return undefined
    }) as never)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(reconcileDueRecurringExpenses({} as never)).resolves.toBe(250)

    expect(jobMocks.sendJob).toHaveBeenCalledTimes(251)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('series-249'))
    warnSpy.mockRestore()
  })

  it('keeps processing due series when resuming a paused group throws', async () => {
    const due = [
      {
        id: 'series-1',
        timeZone: 'UTC',
        occurrencesCreated: 1,
        nextOccurrenceDate: new Date('2026-07-22T00:00:00Z'),
      },
      {
        id: 'series-2',
        timeZone: 'UTC',
        occurrencesCreated: 1,
        nextOccurrenceDate: new Date('2026-07-22T00:00:00Z'),
      },
    ]
    prismaMock.recurringExpenseSeries.findMany
      .mockResolvedValueOnce([
        { ledger: { group: { id: 'group-1' } } },
      ] as never)
      .mockResolvedValueOnce(due as never)
    // resumeRecurringExpenseSeries opens prisma.$transaction; make it throw to
    // surface a benign singleton collision from its transactional send.
    prisma$Transaction.mockRejectedValueOnce(
      new Error('rejected by a queue policy'),
    )
    jobMocks.hasDeadLetteredMaterialization.mockResolvedValue(false)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(reconcileDueRecurringExpenses({} as never)).resolves.toBe(2)

    expect(jobMocks.sendJob).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('group-1'))
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('rejected by a queue policy'),
    )
    warnSpy.mockRestore()
  })
})
