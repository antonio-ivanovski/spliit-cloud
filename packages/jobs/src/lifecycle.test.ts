import type { JobWithMetadata } from 'pg-boss'
import { describe, expect, it, vi } from 'vitest'

import { JOB_WORK_OPTIONS } from './boss'
import { env } from './env'
import { registerHandlers } from './lifecycle'
import { JOB_NAMES } from './registry'
import { createBossMock, makeJob } from './test-helpers'

describe('worker handler context', () => {
  it('forwards retryCount and retryLimit from pg-boss into the handler context', async () => {
    const boss = createBossMock()
    const workMock = vi.mocked(boss.work)
    const handler = vi.fn(async () => undefined)

    await registerHandlers(boss, {
      [JOB_NAMES.NOTIFICATION_DELIVER]: handler,
    })

    expect(workMock).toHaveBeenCalledTimes(1)
    const [name, options, invoke] = workMock.mock.calls[0] as unknown as [
      string,
      { includeMetadata?: boolean },
      (jobs: JobWithMetadata<object>[]) => Promise<void>,
    ]
    expect(name).toBe(JOB_NAMES.NOTIFICATION_DELIVER)
    expect(options.includeMetadata).toBe(true)

    const job = makeJob({ deliveryId: 'delivery-1' })
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
    const boss = createBossMock()
    const workMock = vi.mocked(boss.work)
    const handler = vi.fn(async () => undefined)

    await registerHandlers(boss, {
      [JOB_NAMES.NOTIFICATION_DELIVER]: handler,
      [JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE]: handler,
      [JOB_NAMES.RECONCILE_RECURRING_EXPENSES]: handler,
      [JOB_NAMES.NOTIFICATION_RECONCILE]: handler,
      [JOB_NAMES.NOTIFICATION_CLEANUP]: handler,
    })

    expect(workMock).toHaveBeenCalledTimes(5)
    for (const [name, options] of workMock.mock.calls as unknown as Array<
      [string, Record<string, unknown>]
    >) {
      const expected =
        JOB_WORK_OPTIONS[name as keyof typeof JOB_WORK_OPTIONS]
      expect(options).toEqual(
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
    const boss = createBossMock()
    const workMock = vi.mocked(boss.work)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const successHandler = vi.fn(async () => undefined)
    await registerHandlers(boss, {
      [JOB_NAMES.NOTIFICATION_DELIVER]: successHandler,
    })
    const successJob = makeJob({ deliveryId: 'delivery-1' })
    const successInvoke = workMock.mock.calls[0]?.[2] as unknown as (
      jobs: JobWithMetadata<object>[],
    ) => Promise<void>
    await successInvoke([successJob])

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
    const failInvoke = workMock.mock.calls[1]?.[2] as unknown as (
      jobs: JobWithMetadata<object>[],
    ) => Promise<void>
    await expect(failInvoke([failJob])).rejects.toThrow('boom')

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
