import { beforeEach, describe, expect, it } from 'vitest'
import '../../test/mocks'
import { prismaMock } from '../../test/state'
import { getRecurringSeriesProgress } from './series-progress'

describe('getRecurringSeriesProgress', () => {
  beforeEach(() => {
    prismaMock.group.findUnique.mockReset()
    prismaMock.recurringExpenseSeries.findFirst.mockReset()
  })

  it('returns null when the group does not exist', async () => {
    prismaMock.group.findUnique.mockResolvedValue(null as never)
    await expect(
      getRecurringSeriesProgress('grp-1', 'series-1'),
    ).resolves.toBeNull()
    expect(prismaMock.recurringExpenseSeries.findFirst).not.toHaveBeenCalled()
  })

  it('returns null when the series belongs to another ledger', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    // findFirst should not match — series is on ledger-2, not ledger-1.
    prismaMock.recurringExpenseSeries.findFirst.mockResolvedValue(null as never)
    await expect(
      getRecurringSeriesProgress('grp-1', 'series-other'),
    ).resolves.toBeNull()
    expect(prismaMock.recurringExpenseSeries.findFirst).toHaveBeenCalledWith({
      where: { id: 'series-other', ledgerId: 'ledger-1' },
      select: expect.objectContaining({
        id: true,
        status: true,
        occurrencesCreated: true,
        nextOccurrenceDate: true,
        catchUpBatch: true,
      }),
    })
  })

  it('marks pending=true when nextOccurrenceDate is today (UTC) for an ACTIVE series', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    prismaMock.recurringExpenseSeries.findFirst.mockResolvedValue({
      id: 'series-1',
      status: 'ACTIVE',
      occurrencesCreated: 3,
      nextOccurrenceDate: today,
      catchUpBatch: { dueThrough: today.toISOString().slice(0, 10) },
    } as never)
    await expect(
      getRecurringSeriesProgress('grp-1', 'series-1'),
    ).resolves.toEqual({
      seriesId: 'series-1',
      status: 'ACTIVE',
      occurrencesCreated: 3,
      nextOccurrenceDate: today.toISOString().slice(0, 10),
      dueThrough: today.toISOString().slice(0, 10),
      pending: true,
    })
  })

  it('marks pending=false when the next occurrence is in the future', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    const future = new Date()
    future.setUTCDate(future.getUTCDate() + 7)
    future.setUTCHours(0, 0, 0, 0)
    prismaMock.recurringExpenseSeries.findFirst.mockResolvedValue({
      id: 'series-1',
      status: 'ACTIVE',
      occurrencesCreated: 1,
      nextOccurrenceDate: future,
      catchUpBatch: null,
    } as never)
    await expect(
      getRecurringSeriesProgress('grp-1', 'series-1'),
    ).resolves.toEqual({
      seriesId: 'series-1',
      status: 'ACTIVE',
      occurrencesCreated: 1,
      nextOccurrenceDate: future.toISOString().slice(0, 10),
      dueThrough: null,
      pending: false,
    })
  })

  it('marks pending=false for a terminal series even when dates are past', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    const past = new Date('2026-01-01T00:00:00.000Z')
    prismaMock.recurringExpenseSeries.findFirst.mockResolvedValue({
      id: 'series-1',
      status: 'COMPLETED',
      occurrencesCreated: 5,
      nextOccurrenceDate: past,
      catchUpBatch: null,
    } as never)
    await expect(
      getRecurringSeriesProgress('grp-1', 'series-1'),
    ).resolves.toEqual({
      seriesId: 'series-1',
      status: 'COMPLETED',
      occurrencesCreated: 5,
      nextOccurrenceDate: '2026-01-01',
      dueThrough: null,
      pending: false,
    })
  })

  it('returns null dueThrough when catchUpBatch is malformed', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    const future = new Date()
    future.setUTCDate(future.getUTCDate() + 7)
    future.setUTCHours(0, 0, 0, 0)
    prismaMock.recurringExpenseSeries.findFirst.mockResolvedValue({
      id: 'series-1',
      status: 'ACTIVE',
      occurrencesCreated: 1,
      nextOccurrenceDate: future,
      catchUpBatch: 'not-an-object',
    } as never)
    await expect(
      getRecurringSeriesProgress('grp-1', 'series-1'),
    ).resolves.toMatchObject({ dueThrough: null })
  })
})
