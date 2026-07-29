import type { JobWithMetadata, PgBoss } from 'pg-boss'
import { describe, expect, it, vi } from 'vitest'

import { JOB_WORK_OPTIONS } from './boss'
import { env } from './env'
import { registerHandlers } from './lifecycle'
import { JOB_NAMES } from './registry'

interface WorkCall {
  name: string
  options: {
    includeMetadata?: boolean
    batchSize?: number
    localConcurrency?: number
    pollingIntervalSeconds?: number
  }
  handler: (jobs: JobWithMetadata<object>[]) => Promise<void>
}

function createBossMock() {
  const workCalls: WorkCall[] = []
  const work = vi.fn(
    async (
      name: string,
      options: WorkCall['options'],
      handler: (jobs: JobWithMetadata<object>[]) => Promise<void>,
    ) => {
      workCalls.push({ name, options, handler })
      return `worker-${workCalls.length}`
    },
  )
  return { boss: { work } as unknown as PgBoss, workCalls, work }
}

function makeJob<T extends object>(
  data: T,
  overrides: Partial<JobWithMetadata<T>> = {},
): JobWithMetadata<T> {
  const controller = new AbortController()
  return {
    id: 'job-id',
    name: 'notification.deliver',
    data,
    expireInSeconds: 300,
    heartbeatSeconds: null,
    signal: controller.signal,
    groupId: null,
    groupTier: null,
    priority: 0,
    state: 'active',
    retryLimit: 5,
    retryCount: 2,
    retryDelay: 30,
    retryBackoff: true,
    startAfter: new Date(),
    startedOn: new Date(),
    singletonKey: null,
    singletonOn: null,
    deleteAfterSeconds: 86_400,
    createdOn: new Date(),
    completedOn: null,
    keepUntil: new Date(),
    policy: 'exclusive',
    heartbeatOn: null,
    blocked: false,
    blocking: false,
    pendingDependencies: 0,
    deadLetter: 'notification.deliver.dead-letter',
    output: {},
    sourceName: null,
    sourceId: null,
    sourceCreatedOn: null,
    sourceRetryCount: null,
    ...overrides,
  } as JobWithMetadata<T>
}

describe('worker handler context', () => {
  it('forwards retryCount and retryLimit from pg-boss into the handler context', async () => {
    const { boss, workCalls, work } = createBossMock()
    const handler = vi.fn(async () => undefined)

    await registerHandlers(boss, {
      [JOB_NAMES.NOTIFICATION_DELIVER]: handler,
    })

    expect(work).toHaveBeenCalledTimes(1)
    expect(workCalls[0]?.name).toBe(JOB_NAMES.NOTIFICATION_DELIVER)
    expect(workCalls[0]?.options.includeMetadata).toBe(true)

    const job = makeJob({ deliveryId: 'delivery-1' })
    const invoke = workCalls[0]?.handler
    expect(invoke).toBeDefined()
    await invoke!([job])

    expect(handler).toHaveBeenCalledWith(
      { deliveryId: 'delivery-1' },
      expect.objectContaining({
        boss,
        name: JOB_NAMES.NOTIFICATION_DELIVER,
        jobId: 'job-id',
        retryCount: 2,
        retryLimit: 5,
      }),
    )
  })

  it('registers each queue with its JOB_WORK_OPTIONS concurrency and poll', async () => {
    const { boss, workCalls, work } = createBossMock()
    const handler = vi.fn(async () => undefined)

    await registerHandlers(boss, {
      [JOB_NAMES.NOTIFICATION_DELIVER]: handler,
      [JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE]: handler,
      [JOB_NAMES.RECONCILE_RECURRING_EXPENSES]: handler,
      [JOB_NAMES.NOTIFICATION_RECONCILE]: handler,
      [JOB_NAMES.NOTIFICATION_CLEANUP]: handler,
    })

    expect(work).toHaveBeenCalledTimes(5)
    for (const call of workCalls) {
      const expected =
        JOB_WORK_OPTIONS[call.name as keyof typeof JOB_WORK_OPTIONS]
      expect(call.options).toEqual(
        expect.objectContaining({
          batchSize: 1,
          includeMetadata: true,
          localConcurrency: expected.localConcurrency,
          pollingIntervalSeconds: expected.pollingIntervalSeconds,
        }),
      )
    }

    expect(
      JOB_WORK_OPTIONS[JOB_NAMES.NOTIFICATION_DELIVER].pollingIntervalSeconds,
    ).toBe(env.JOBS_POLLING_INTERVAL_SECONDS)
    expect(
      JOB_WORK_OPTIONS[JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE]
        .pollingIntervalSeconds,
    ).toBe(env.JOBS_MAINTENANCE_POLLING_INTERVAL_SECONDS)
    expect(
      JOB_WORK_OPTIONS[JOB_NAMES.NOTIFICATION_RECONCILE].localConcurrency,
    ).toBe(1)
    expect(
      JOB_WORK_OPTIONS[JOB_NAMES.NOTIFICATION_CLEANUP].localConcurrency,
    ).toBe(1)
  })

  it('logs retryCount on success and failure', async () => {
    const { boss, workCalls } = createBossMock()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const successHandler = vi.fn(async () => undefined)
    await registerHandlers(boss, {
      [JOB_NAMES.NOTIFICATION_DELIVER]: successHandler,
    })
    const successJob = makeJob({ deliveryId: 'delivery-1' })
    await workCalls[0]!.handler([successJob])

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"retryCount":2'),
    )

    const failHandler = vi.fn(async () => {
      throw new Error('boom')
    })
    await registerHandlers(boss, {
      [JOB_NAMES.NOTIFICATION_DELIVER]: failHandler,
    })
    const failJob = makeJob({ deliveryId: 'delivery-1' })
    await expect(workCalls[1]!.handler([failJob])).rejects.toThrow('boom')

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"retryCount":2'),
    )
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"retryLimit":5'),
    )

    logSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
