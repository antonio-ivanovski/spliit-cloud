// organize-imports-ignore: test/mocks must register the Prisma mock first.
import '../../test/mocks'
import { prisma$QueryRaw, prismaMock } from '../../test/state'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const jobMocks = vi.hoisted(() => ({ sendJob: vi.fn() }))

vi.mock(import('@spliit/jobs'), async (importOriginal) => {
  const jobs = await importOriginal()
  return {
    ...jobs,
    env: { ...jobs.env, JOBS_ENABLED: false },
    sendJob: jobMocks.sendJob,
  }
})

import { resumeRecurringExpenseSeries } from './recurrence-series'

describe('resumeRecurringExpenseSeries', () => {
  beforeEach(() => {
    jobMocks.sendJob.mockReset()
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
})
