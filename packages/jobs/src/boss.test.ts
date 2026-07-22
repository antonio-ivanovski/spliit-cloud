import { describe, expect, it, vi } from 'vitest'
import {
  ensureQueues,
  hasDeadLetteredMaterialization,
  MATERIALIZATION_EXPIRE_SECONDS,
  materializationSingletonKey,
  sendJob,
  type SpliitBoss,
} from './boss'
import {
  JOB_NAMES,
  RECURRING_MATERIALIZATION_DLQ,
  RECURRING_MATERIALIZATION_QUEUE,
  RECURRING_RECONCILIATION_DLQ,
  RECURRING_RECONCILIATION_QUEUE,
} from './registry'

function createBossMock(getQueue = vi.fn().mockResolvedValue(null)) {
  return {
    getQueue,
    createQueue: vi.fn().mockResolvedValue(undefined),
    updateQueue: vi.fn().mockResolvedValue(undefined),
    deleteQueue: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue('job-id'),
    findJobs: vi.fn().mockResolvedValue([]),
  } as unknown as SpliitBoss
}

describe('pg-boss queue configuration', () => {
  it('creates materialization as an exclusive queue with a short expiry', async () => {
    const boss = createBossMock()

    await ensureQueues(boss)

    expect(boss.createQueue).toHaveBeenCalledWith(
      RECURRING_MATERIALIZATION_QUEUE,
      expect.objectContaining({
        policy: 'exclusive',
        expireInSeconds: MATERIALIZATION_EXPIRE_SECONDS,
        deadLetter: RECURRING_MATERIALIZATION_DLQ,
      }),
    )
    expect(MATERIALIZATION_EXPIRE_SECONDS).toBe(300)
    expect(boss.updateQueue).toHaveBeenCalledWith(
      RECURRING_MATERIALIZATION_QUEUE,
      expect.objectContaining({
        expireInSeconds: 300,
        deadLetter: RECURRING_MATERIALIZATION_DLQ,
      }),
    )
    expect(boss.createQueue).toHaveBeenCalledWith(
      RECURRING_RECONCILIATION_QUEUE,
      expect.objectContaining({ policy: 'exclusive' }),
    )
  })

  it('fails fast when an existing queue has a stale immutable policy', async () => {
    const getQueue = vi
      .fn()
      .mockImplementation(async (name: string) =>
        name === RECURRING_MATERIALIZATION_QUEUE
          ? { policy: 'standard', totalCount: 0 }
          : null,
      )
    const boss = createBossMock(getQueue)

    await expect(ensureQueues(boss)).rejects.toThrow(
      'refusing to mutate an existing queue at startup',
    )
  })

  it('applies queue-specific send defaults', async () => {
    const boss = createBossMock()

    await sendJob(boss, JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE, {
      seriesId: 'series',
      sequence: 2,
      occurrenceDate: '2026-07-22',
    })
    await sendJob(boss, JOB_NAMES.RECONCILE_RECURRING_EXPENSES, {})

    expect(boss.send).toHaveBeenNthCalledWith(
      1,
      JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
      expect.anything(),
      expect.objectContaining({
        retryLimit: 5,
        deadLetter: RECURRING_MATERIALIZATION_DLQ,
        singletonKey: 'series:2:2026-07-22',
      }),
    )
    expect(boss.send).toHaveBeenNthCalledWith(
      2,
      JOB_NAMES.RECONCILE_RECURRING_EXPENSES,
      expect.anything(),
      expect.objectContaining({
        retryLimit: 0,
        deadLetter: RECURRING_RECONCILIATION_DLQ,
      }),
    )
  })

  it('finds a matching queued materialization in the dead-letter queue', async () => {
    const boss = createBossMock()
    vi.mocked(boss.findJobs).mockResolvedValue([
      {
        sourceName: RECURRING_MATERIALIZATION_QUEUE,
        data: { seriesId: 'series', sequence: 2, occurrenceDate: '2026-07-22' },
      },
    ] as never)

    await expect(
      hasDeadLetteredMaterialization(boss, {
        seriesId: 'series',
        sequence: 2,
        occurrenceDate: '2026-07-22',
      }),
    ).resolves.toBe(true)
    expect(boss.findJobs).toHaveBeenCalledWith(RECURRING_MATERIALIZATION_DLQ, {
      queued: true,
      key: 'series:2:2026-07-22',
      data: {
        seriesId: 'series',
        sequence: 2,
        occurrenceDate: '2026-07-22',
      },
    })
  })

  it('uses the occurrence date to distinguish a rescheduled sequence', () => {
    expect(
      materializationSingletonKey({
        seriesId: 'series',
        sequence: 2,
        occurrenceDate: '2026-07-22',
      }),
    ).not.toBe(
      materializationSingletonKey({
        seriesId: 'series',
        sequence: 2,
        occurrenceDate: '2026-07-23',
      }),
    )
  })
})
