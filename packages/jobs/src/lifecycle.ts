import type { JobWithMetadata, PgBoss } from 'pg-boss'
import { sendJob } from './boss'
import { env } from './env'
import {
  JOB_NAMES,
  jobPayloadSchema,
  jobPayloadSchemas,
  RECURRING_RECONCILIATION_DLQ,
  type JobName,
  type JobPayload,
} from './registry'

export interface JobHandlerContext<Name extends JobName = JobName> {
  boss: PgBoss
  name: Name
  jobId: string
  signal: AbortSignal
  retryCount: number
  retryLimit: number
}

export type JobHandler<Name extends JobName> = (
  payload: JobPayload<Name>,
  context: JobHandlerContext<Name>,
) => Promise<void>

export type JobHandlers = {
  [Name in JobName]?: JobHandler<Name>
}

export function assertHandlersRegistered(
  handlers: JobHandlers,
  required: readonly JobName[] = Object.keys(jobPayloadSchemas) as JobName[],
): void {
  const missing = required.filter((name) => !handlers[name])
  if (missing.length > 0) {
    throw new Error(`Missing background job handlers: ${missing.join(', ')}`)
  }
}

const logJob = (
  level: 'info' | 'error',
  message: string,
  fields: Record<string, unknown> = {},
) => {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    component: 'worker',
    message,
    ...fields,
  })
  if (level === 'error') console.error(entry)
  else console.log(entry)
}

export async function registerHandlers(
  boss: PgBoss,
  handlers: JobHandlers,
): Promise<void> {
  for (const [name, handler] of Object.entries(handlers) as [
    JobName,
    JobHandler<JobName> | undefined,
  ][]) {
    if (!handler) continue
    await boss.work(
      name,
      {
        batchSize: 1,
        localConcurrency: env.JOBS_MAX_CONCURRENCY,
        pollingIntervalSeconds: 1,
        includeMetadata: true,
      },
      async (jobs: JobWithMetadata<object>[]) => {
        const job = jobs[0]
        if (!job) return
        const parsed = jobPayloadSchema(name).parse(job.data)
        try {
          await handler(
            parsed as never,
            {
              boss,
              name,
              jobId: job.id,
              signal: job.signal,
              retryCount: job.retryCount,
              retryLimit: job.retryLimit,
            } as never,
          )
          logJob('info', 'job completed', {
            name,
            jobId: job.id,
            retryCount: job.retryCount,
          })
        } catch (error) {
          logJob('error', 'job failed', {
            name,
            jobId: job.id,
            retryCount: job.retryCount,
            retryLimit: job.retryLimit,
            error: error instanceof Error ? error.message : String(error),
          })
          throw error
        }
      },
    )
  }
}

export async function scheduleReconciliation(boss: PgBoss): Promise<void> {
  await boss.schedule(
    JOB_NAMES.RECONCILE_RECURRING_EXPENSES,
    env.JOBS_RECONCILIATION_CRON,
    {},
    { retryLimit: 0, key: 'recurring-expense-reconciliation' },
  )
}

export async function enqueueReconciliation(
  boss: PgBoss,
): Promise<string | null> {
  return sendJob(
    boss,
    JOB_NAMES.RECONCILE_RECURRING_EXPENSES,
    {},
    {
      singletonKey: 'recurring-expense-reconciliation-now',
      retryLimit: 0,
      deadLetter: RECURRING_RECONCILIATION_DLQ,
    },
  )
}
