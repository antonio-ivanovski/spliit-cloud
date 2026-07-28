// organize-imports-ignore: test/mocks must register the Prisma mock first.
import '../../test/mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prisma$QueryRaw, prismaMock } from '../../test/state'

const jobMocks = vi.hoisted(() => ({
  sendJob: vi.fn(),
  env: { JOBS_ENABLED: false },
}))

vi.mock(import('@spliit/jobs'), async (importOriginal) => {
  const jobs = await importOriginal()
  return {
    ...jobs,
    env: {
      ...jobs.env,
      get JOBS_ENABLED() {
        return jobMocks.env.JOBS_ENABLED
      },
    },
    sendJob: jobMocks.sendJob,
  }
})

import { resumeRecurringExpenseSeries } from './recurrence-series'

describe('resumeRecurringExpenseSeries', () => {
  beforeEach(() => {
    jobMocks.sendJob.mockReset()
    jobMocks.env.JOBS_ENABLED = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('locks the group before series rows and skips enqueue when jobs are disabled', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
      archived: false,
    } as never)
    prismaMock.recurringExpenseSeries.findMany.mockResolvedValue([
      { id: 'series-1' },
    ] as never)
    prismaMock.recurringExpenseSeries.findUnique.mockResolvedValue({
      id: 'series-1',
      status: 'PAUSED',
      anchorDate: new Date('2030-01-01T00:00:00Z'),
      frequency: 'MONTHLY',
      interval: 1,
      nextOccurrenceOrdinal: 2,
      occurrencesCreated: 1,
      endType: 'INDEFINITE',
      occurrenceLimit: null,
      endDate: null,
    } as never)

    await expect(resumeRecurringExpenseSeries('group-1')).resolves.toBe(1)
    expect(prisma$QueryRaw).toHaveBeenCalledTimes(2)
    expect(prisma$QueryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.recurringExpenseSeries.findMany.mock.invocationCallOrder[0]!,
    )
    expect(prisma$QueryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      prismaMock.recurringExpenseSeries.findUnique.mock.invocationCallOrder[0]!,
    )
    expect(prismaMock.recurringExpenseSeries.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'series-1' },
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    )
    expect(jobMocks.sendJob).not.toHaveBeenCalled()
  })

  it('advances past overdue ordinals without consuming occurrence count', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'))
    jobMocks.env.JOBS_ENABLED = true
    const boss = {} as never
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
      archived: false,
    } as never)
    prismaMock.recurringExpenseSeries.findMany.mockResolvedValue([
      { id: 'series-1' },
    ] as never)
    prismaMock.recurringExpenseSeries.findUnique.mockResolvedValue({
      id: 'series-1',
      status: 'PAUSED',
      anchorDate: new Date('2026-01-01T00:00:00.000Z'),
      frequency: 'MONTHLY',
      interval: 1,
      nextOccurrenceOrdinal: 2,
      occurrencesCreated: 1,
      endType: 'INDEFINITE',
      occurrenceLimit: null,
      endDate: null,
    } as never)

    await expect(resumeRecurringExpenseSeries('group-1', boss)).resolves.toBe(1)
    expect(prismaMock.recurringExpenseSeries.update).toHaveBeenCalledWith({
      where: { id: 'series-1' },
      data: {
        status: 'ACTIVE',
        nextOccurrenceDate: new Date('2026-08-01T00:00:00.000Z'),
        nextOccurrenceOrdinal: 8,
        version: { increment: 1 },
      },
    })
    expect(
      prismaMock.recurringExpenseSeries.update.mock.calls[0]?.[0].data,
    ).not.toHaveProperty('occurrencesCreated')
    expect(jobMocks.sendJob).toHaveBeenCalledTimes(1)
    expect(jobMocks.sendJob).toHaveBeenCalledWith(
      boss,
      'recurring-expense.materialize',
      {
        seriesId: 'series-1',
        sequence: 2,
        occurrenceDate: '2026-08-01',
      },
      expect.objectContaining({
        singletonKey: 'series-1:2:2026-08-01',
      }),
    )
  })

  it('completes a date-ended series when its next future occurrence passed the end date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'))
    jobMocks.env.JOBS_ENABLED = true
    const boss = {} as never
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
      archived: false,
    } as never)
    prismaMock.recurringExpenseSeries.findMany.mockResolvedValue([
      { id: 'series-date' },
    ] as never)
    prismaMock.recurringExpenseSeries.findUnique.mockResolvedValue({
      id: 'series-date',
      status: 'PAUSED',
      anchorDate: new Date('2026-01-01T00:00:00.000Z'),
      frequency: 'MONTHLY',
      interval: 1,
      nextOccurrenceOrdinal: 2,
      occurrencesCreated: 1,
      endType: 'DATE',
      occurrenceLimit: null,
      endDate: new Date('2026-07-31T00:00:00.000Z'),
    } as never)

    await expect(resumeRecurringExpenseSeries('group-1', boss)).resolves.toBe(0)
    expect(prismaMock.recurringExpenseSeries.update).toHaveBeenCalledWith({
      where: { id: 'series-date' },
      data: {
        status: 'COMPLETED',
        version: { increment: 1 },
      },
    })
    expect(jobMocks.sendJob).not.toHaveBeenCalled()
  })

  it('completes a count-ended series when all occurrences were already created', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'))
    jobMocks.env.JOBS_ENABLED = true
    const boss = {} as never
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
      archived: false,
    } as never)
    prismaMock.recurringExpenseSeries.findMany.mockResolvedValue([
      { id: 'series-count' },
    ] as never)
    prismaMock.recurringExpenseSeries.findUnique.mockResolvedValue({
      id: 'series-count',
      status: 'PAUSED',
      anchorDate: new Date('2026-01-01T00:00:00.000Z'),
      frequency: 'MONTHLY',
      interval: 1,
      nextOccurrenceOrdinal: 2,
      occurrencesCreated: 3,
      endType: 'COUNT',
      occurrenceLimit: 3,
      endDate: null,
    } as never)

    await expect(resumeRecurringExpenseSeries('group-1', boss)).resolves.toBe(0)
    expect(prismaMock.recurringExpenseSeries.update).toHaveBeenCalledWith({
      where: { id: 'series-count' },
      data: {
        status: 'COMPLETED',
        version: { increment: 1 },
      },
    })
    expect(jobMocks.sendJob).not.toHaveBeenCalled()
  })

  it('does not resume series when the locked group has been re-archived', async () => {
    jobMocks.env.JOBS_ENABLED = true
    const boss = {} as never
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
      archived: true,
    } as never)

    await expect(resumeRecurringExpenseSeries('group-1', boss)).resolves.toBe(0)
    expect(prisma$QueryRaw).toHaveBeenCalledTimes(1)
    expect(prisma$QueryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.group.findUnique.mock.invocationCallOrder[0]!,
    )
    expect(prismaMock.recurringExpenseSeries.findMany).not.toHaveBeenCalled()
    expect(prismaMock.recurringExpenseSeries.update).not.toHaveBeenCalled()
    expect(jobMocks.sendJob).not.toHaveBeenCalled()
  })
})
