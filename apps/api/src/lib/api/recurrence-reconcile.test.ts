// organize-imports-ignore: test/mocks must register the Prisma mock first.
import '../../test/mocks'
import { prismaMock } from '../../test/state'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('bounds reconciliation pages and schedules a continuation', async () => {
    const due = Array.from({ length: 250 }, (_, index) => ({
      id: `series-${index}`,
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
})
