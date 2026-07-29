import { describe, expect, it, vi } from 'vitest'

import {
  ensureQueues,
  hasDeadLetteredMaterialization,
  insertJobs,
  JOB_QUEUE_OPTIONS,
  JOB_SEND_OPTIONS,
  JOB_WORK_OPTIONS,
  MATERIALIZATION_EXPIRE_SECONDS,
  materializationSingletonKey,
  NOTIFICATION_DELIVER_EXPIRE_SECONDS,
  NOTIFICATION_MAINTENANCE_EXPIRE_SECONDS,
  notificationDeliverSingletonKey,
  sendJob,
  type SpliitBoss,
} from './boss'
import { env } from './env'
import {
  JOB_NAMES,
  NOTIFICATION_CLEANUP_DLQ,
  NOTIFICATION_CLEANUP_QUEUE,
  NOTIFICATION_DELIVER_DLQ,
  NOTIFICATION_DELIVER_QUEUE,
  NOTIFICATION_RECONCILE_DLQ,
  NOTIFICATION_RECONCILE_QUEUE,
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
    insert: vi.fn().mockResolvedValue(['job-id-1', 'job-id-2']),
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

  it('matches dead-lettered materializations', async () => {
    const boss = createBossMock()
    vi.mocked(boss.findJobs).mockResolvedValue([
      {
        sourceName: RECURRING_MATERIALIZATION_QUEUE,
        data: {
          seriesId: 'series',
          sequence: 2,
          occurrenceDate: '2026-07-22',
        },
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
})

describe('notification job queue configuration', () => {
  it('provisions every dead-letter queue before its source queue', async () => {
    const boss = createBossMock()
    const order: string[] = []
    vi.mocked(boss.createQueue).mockImplementation(async (name: string) => {
      order.push(name)
    })

    await ensureQueues(boss)

    const dlqNames = [
      RECURRING_MATERIALIZATION_DLQ,
      RECURRING_RECONCILIATION_DLQ,
      NOTIFICATION_DELIVER_DLQ,
      NOTIFICATION_RECONCILE_DLQ,
      NOTIFICATION_CLEANUP_DLQ,
    ] as const
    const sourceNames = [
      RECURRING_MATERIALIZATION_QUEUE,
      RECURRING_RECONCILIATION_QUEUE,
      NOTIFICATION_DELIVER_QUEUE,
      NOTIFICATION_RECONCILE_QUEUE,
      NOTIFICATION_CLEANUP_QUEUE,
    ] as const

    for (let i = 0; i < dlqNames.length; i++) {
      const dlqIndex = order.indexOf(dlqNames[i])
      const sourceIndex = order.indexOf(sourceNames[i])
      expect(dlqIndex).toBeGreaterThanOrEqual(0)
      expect(sourceIndex).toBeGreaterThan(dlqIndex)
    }

    const firstSource = order.findIndex((name) => name === sourceNames[0])
    const lastDlq = Math.max(...dlqNames.map((name) => order.indexOf(name)))
    expect(firstSource).toBeGreaterThan(lastDlq)
  })

  it('configures the notification deliver queue as exclusive with notify enabled', async () => {
    expect(JOB_QUEUE_OPTIONS[NOTIFICATION_DELIVER_QUEUE].policy).toBe(
      'exclusive',
    )
    expect(JOB_QUEUE_OPTIONS[NOTIFICATION_DELIVER_QUEUE].notify).toBe(true)
    expect(JOB_QUEUE_OPTIONS[NOTIFICATION_DELIVER_QUEUE].deadLetter).toBe(
      NOTIFICATION_DELIVER_DLQ,
    )
  })

  it('configures the notification maintenance queues with bounded expiry, no retries, and notify', async () => {
    expect(JOB_SEND_OPTIONS[NOTIFICATION_RECONCILE_QUEUE].retryLimit).toBe(0)
    expect(JOB_SEND_OPTIONS[NOTIFICATION_RECONCILE_QUEUE].expireInSeconds).toBe(
      NOTIFICATION_MAINTENANCE_EXPIRE_SECONDS,
    )
    expect(JOB_SEND_OPTIONS[NOTIFICATION_CLEANUP_QUEUE].retryLimit).toBe(0)
    expect(JOB_SEND_OPTIONS[NOTIFICATION_CLEANUP_QUEUE].expireInSeconds).toBe(
      NOTIFICATION_MAINTENANCE_EXPIRE_SECONDS,
    )
    expect(NOTIFICATION_MAINTENANCE_EXPIRE_SECONDS).toBe(300)
    expect(JOB_QUEUE_OPTIONS[NOTIFICATION_RECONCILE_QUEUE].notify).toBe(true)
    expect(JOB_QUEUE_OPTIONS[NOTIFICATION_CLEANUP_QUEUE].notify).toBe(true)
  })

  it('uses slower per-queue work options to cut idle polling', () => {
    expect(JOB_WORK_OPTIONS[NOTIFICATION_DELIVER_QUEUE]).toEqual({
      localConcurrency: env.JOBS_MAX_CONCURRENCY,
      pollingIntervalSeconds: env.JOBS_POLLING_INTERVAL_SECONDS,
    })
    expect(JOB_WORK_OPTIONS[RECURRING_MATERIALIZATION_QUEUE]).toEqual({
      localConcurrency: env.JOBS_MAX_CONCURRENCY,
      pollingIntervalSeconds: env.JOBS_MAINTENANCE_POLLING_INTERVAL_SECONDS,
    })
    expect(JOB_WORK_OPTIONS[RECURRING_RECONCILIATION_QUEUE]).toEqual({
      localConcurrency: 1,
      pollingIntervalSeconds: env.JOBS_MAINTENANCE_POLLING_INTERVAL_SECONDS,
    })
    expect(JOB_WORK_OPTIONS[NOTIFICATION_RECONCILE_QUEUE]).toEqual({
      localConcurrency: 1,
      pollingIntervalSeconds: env.JOBS_MAINTENANCE_POLLING_INTERVAL_SECONDS,
    })
    expect(JOB_WORK_OPTIONS[NOTIFICATION_CLEANUP_QUEUE]).toEqual({
      localConcurrency: 1,
      pollingIntervalSeconds: env.JOBS_MAINTENANCE_POLLING_INTERVAL_SECONDS,
    })
    expect(env.JOBS_MAX_CONCURRENCY).toBe(1)
    expect(env.JOBS_POLLING_INTERVAL_SECONDS).toBe(60)
    expect(env.JOBS_MAINTENANCE_POLLING_INTERVAL_SECONDS).toBe(300)
    expect(env.JOBS_RECONCILIATION_CRON).toBe('*/30 * * * *')
    expect(env.JOBS_NOTIFICATION_RECONCILE_CRON).toBe('*/15 * * * *')
    expect(env.HEALTH_RUNNABLE_LAG_THRESHOLD_MS).toBe(900_000)
  })

  it('sends notification deliveries with exponential backoff and a delivery-ID singleton key', async () => {
    const boss = createBossMock()

    await sendJob(boss, JOB_NAMES.NOTIFICATION_DELIVER, {
      deliveryId: 'delivery-123',
    })

    expect(boss.send).toHaveBeenCalledWith(
      JOB_NAMES.NOTIFICATION_DELIVER,
      expect.objectContaining({ deliveryId: 'delivery-123' }),
      expect.objectContaining({
        retryLimit: 5,
        retryBackoff: true,
        expireInSeconds: NOTIFICATION_DELIVER_EXPIRE_SECONDS,
        deadLetter: NOTIFICATION_DELIVER_DLQ,
        singletonKey: 'delivery-123',
      }),
    )
    expect(
      notificationDeliverSingletonKey({ deliveryId: 'delivery-123' }),
    ).toBe('delivery-123')
    expect(NOTIFICATION_DELIVER_EXPIRE_SECONDS).toBe(300)
  })

  it('lets the caller override the notification delivery retry limit', async () => {
    const boss = createBossMock()

    await sendJob(
      boss,
      JOB_NAMES.NOTIFICATION_DELIVER,
      { deliveryId: 'delivery-123' },
      { retryLimit: 0 },
    )

    expect(boss.send).toHaveBeenCalledWith(
      JOB_NAMES.NOTIFICATION_DELIVER,
      expect.anything(),
      expect.objectContaining({
        retryLimit: 0,
        singletonKey: 'delivery-123',
      }),
    )
  })
})

describe('insertJobs', () => {
  it('returns null for an empty payload array and never calls boss.insert', async () => {
    const boss = createBossMock()

    const result = await insertJobs(boss, JOB_NAMES.NOTIFICATION_DELIVER, [])

    expect(result).toBeNull()
    expect(boss.insert).not.toHaveBeenCalled()
  })

  it('spreads per-job send options into every job object so retry/expiry/DLQ match sendJob', async () => {
    const boss = createBossMock()
    vi.mocked(boss.insert).mockResolvedValue(['id-1', 'id-2'])

    const db = { query: vi.fn() } as never
    await insertJobs(
      boss,
      JOB_NAMES.NOTIFICATION_DELIVER,
      [{ deliveryId: 'delivery-A' }, { deliveryId: 'delivery-B' }],
      { db },
    )

    expect(boss.insert).toHaveBeenCalledTimes(1)
    const [queue, jobs, options] = vi.mocked(boss.insert).mock.calls[0]!
    expect(queue).toBe(JOB_NAMES.NOTIFICATION_DELIVER)
    expect(options).toEqual({ db, returnId: true })
    expect(jobs).toEqual([
      expect.objectContaining({
        data: { deliveryId: 'delivery-A' },
        retryLimit: 5,
        retryBackoff: true,
        expireInSeconds: NOTIFICATION_DELIVER_EXPIRE_SECONDS,
        deadLetter: NOTIFICATION_DELIVER_DLQ,
        singletonKey: 'delivery-A',
      }),
      expect.objectContaining({
        data: { deliveryId: 'delivery-B' },
        retryLimit: 5,
        retryBackoff: true,
        expireInSeconds: NOTIFICATION_DELIVER_EXPIRE_SECONDS,
        deadLetter: NOTIFICATION_DELIVER_DLQ,
        singletonKey: 'delivery-B',
      }),
    ])
  })

  it('forwards the transaction-bound db exactly as supplied', async () => {
    const boss = createBossMock()
    const db = { __txBound: true, query: vi.fn() } as never

    await insertJobs(
      boss,
      JOB_NAMES.NOTIFICATION_DELIVER,
      [{ deliveryId: 'delivery-1' }],
      { db },
    )

    const options = vi.mocked(boss.insert).mock.calls[0]?.[2]
    expect(options).toEqual({ db, returnId: true })
    expect((options as { db: unknown }).db).toBe(db)
  })

  it('omits the db option when none is supplied', async () => {
    const boss = createBossMock()

    await insertJobs(boss, JOB_NAMES.NOTIFICATION_DELIVER, [
      { deliveryId: 'delivery-1' },
    ])

    const options = vi.mocked(boss.insert).mock.calls[0]?.[2]
    expect(options).toEqual({ returnId: true })
  })

  it('forwards the singleton key derived from the payload for materialization jobs', async () => {
    const boss = createBossMock()
    vi.mocked(boss.insert).mockResolvedValue(['id-1'])

    await insertJobs(boss, JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE, [
      { seriesId: 'series-1', sequence: 7, occurrenceDate: '2026-07-22' },
    ])

    const jobs = vi.mocked(boss.insert).mock.calls[0]?.[1] as Array<{
      data: { seriesId: string; sequence: number; occurrenceDate: string }
      singletonKey?: string
    }>
    expect(jobs[0]).toMatchObject({
      data: { seriesId: 'series-1', sequence: 7, occurrenceDate: '2026-07-22' },
      singletonKey: 'series-1:7:2026-07-22',
    })
    expect(jobs[0]).toMatchObject({
      retryLimit: JOB_SEND_OPTIONS[RECURRING_MATERIALIZATION_QUEUE].retryLimit,
      deadLetter: RECURRING_MATERIALIZATION_DLQ,
    })
  })

  it('rejects payloads that do not satisfy the registered schema', async () => {
    const boss = createBossMock()

    await expect(
      insertJobs(boss, JOB_NAMES.NOTIFICATION_DELIVER, [
        // Missing `deliveryId`.
        {} as never,
      ]),
    ).rejects.toThrow()
    expect(boss.insert).not.toHaveBeenCalled()
  })

  it('returns the ids pg-boss hands back so the caller can persist them', async () => {
    const boss = createBossMock()
    vi.mocked(boss.insert).mockResolvedValue(['id-1', 'id-2', 'id-3'])

    const ids = await insertJobs(boss, JOB_NAMES.NOTIFICATION_DELIVER, [
      { deliveryId: 'd-1' },
      { deliveryId: 'd-2' },
      { deliveryId: 'd-3' },
    ])

    expect(ids).toEqual(['id-1', 'id-2', 'id-3'])
  })
})
