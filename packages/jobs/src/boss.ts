import type {
  PrismaTransactionLike,
  Queue,
  ScheduleOptions,
  SendOptions,
} from 'pg-boss'
import { fromPrisma, PgBoss } from 'pg-boss'

import { env } from './env'
import {
  jobPayloadSchema,
  NOTIFICATION_CLEANUP_DLQ,
  NOTIFICATION_CLEANUP_QUEUE,
  BUDGET_EVALUATE_QUEUE,
  BUDGET_EVALUATE_DLQ,
  NOTIFICATION_DELIVER_DLQ,
  NOTIFICATION_DELIVER_QUEUE,
  NOTIFICATION_RECONCILE_DLQ,
  NOTIFICATION_RECONCILE_QUEUE,
  RECURRING_MATERIALIZATION_DLQ,
  RECURRING_MATERIALIZATION_QUEUE,
  RECURRING_RECONCILIATION_DLQ,
  RECURRING_RECONCILIATION_QUEUE,
  type JobName,
  type JobPayload,
} from './registry'

export const MATERIALIZATION_EXPIRE_SECONDS = 300
export const NOTIFICATION_DELIVER_EXPIRE_SECONDS = 300
export const NOTIFICATION_MAINTENANCE_EXPIRE_SECONDS = 300

export const JOB_SEND_OPTIONS = {
  [RECURRING_MATERIALIZATION_QUEUE]: {
    retryLimit: env.JOBS_RETRY_LIMIT,
    retryDelay: env.JOBS_RETRY_BACKOFF_SECONDS,
    retryBackoff: true,
    expireInSeconds: MATERIALIZATION_EXPIRE_SECONDS,
    retentionSeconds: env.JOBS_RETENTION_SECONDS,
    deadLetter: RECURRING_MATERIALIZATION_DLQ,
  },
  [RECURRING_RECONCILIATION_QUEUE]: {
    retryLimit: 0,
    expireInSeconds: MATERIALIZATION_EXPIRE_SECONDS,
    retentionSeconds: env.JOBS_RETENTION_SECONDS,
    deadLetter: RECURRING_RECONCILIATION_DLQ,
  },
  [NOTIFICATION_DELIVER_QUEUE]: {
    retryLimit: env.JOBS_RETRY_LIMIT,
    retryDelay: env.JOBS_RETRY_BACKOFF_SECONDS,
    retryBackoff: true,
    expireInSeconds: NOTIFICATION_DELIVER_EXPIRE_SECONDS,
    retentionSeconds: env.JOBS_RETENTION_SECONDS,
    deadLetter: NOTIFICATION_DELIVER_DLQ,
  },
  [NOTIFICATION_RECONCILE_QUEUE]: {
    retryLimit: 0,
    expireInSeconds: NOTIFICATION_MAINTENANCE_EXPIRE_SECONDS,
    retentionSeconds: env.JOBS_RETENTION_SECONDS,
    deadLetter: NOTIFICATION_RECONCILE_DLQ,
  },
  [NOTIFICATION_CLEANUP_QUEUE]: {
    retryLimit: 0,
    expireInSeconds: NOTIFICATION_MAINTENANCE_EXPIRE_SECONDS,
    retentionSeconds: env.JOBS_RETENTION_SECONDS,
    deadLetter: NOTIFICATION_CLEANUP_DLQ,
  },
  [BUDGET_EVALUATE_QUEUE]: {
    retryLimit: 0,
    expireInSeconds: NOTIFICATION_MAINTENANCE_EXPIRE_SECONDS,
    retentionSeconds: env.JOBS_RETENTION_SECONDS,
    deadLetter: BUDGET_EVALUATE_DLQ,
  },
} as const satisfies Record<JobName, SendOptions>

export const JOB_QUEUE_OPTIONS = {
  [RECURRING_MATERIALIZATION_QUEUE]: {
    ...JOB_SEND_OPTIONS[RECURRING_MATERIALIZATION_QUEUE],
    policy: 'exclusive',
    notify: true,
  },
  [RECURRING_RECONCILIATION_QUEUE]: {
    ...JOB_SEND_OPTIONS[RECURRING_RECONCILIATION_QUEUE],
    policy: 'exclusive',
    notify: true,
  },
  [NOTIFICATION_DELIVER_QUEUE]: {
    ...JOB_SEND_OPTIONS[NOTIFICATION_DELIVER_QUEUE],
    policy: 'exclusive',
    notify: true,
  },
  [NOTIFICATION_RECONCILE_QUEUE]: {
    ...JOB_SEND_OPTIONS[NOTIFICATION_RECONCILE_QUEUE],
    notify: true,
  },
  [NOTIFICATION_CLEANUP_QUEUE]: {
    ...JOB_SEND_OPTIONS[NOTIFICATION_CLEANUP_QUEUE],
    notify: true,
  },
  [BUDGET_EVALUATE_QUEUE]: {
    ...JOB_SEND_OPTIONS[BUDGET_EVALUATE_QUEUE],
    notify: true,
  },
} as const satisfies Record<JobName, Omit<Queue, 'name'>>

export type JobWorkOptions = {
  localConcurrency: number
  pollingIntervalSeconds: number
}

/**
 * Per-queue worker poll/concurrency. Hot notification delivery stays on the
 * shorter poll; materialization and maintenance use a slower backstop so idle
 * empty-fetches do not dominate VPS CPU when LISTEN/NOTIFY is unavailable.
 */
export const JOB_WORK_OPTIONS = {
  [NOTIFICATION_DELIVER_QUEUE]: {
    localConcurrency: env.JOBS_MAX_CONCURRENCY,
    pollingIntervalSeconds: env.JOBS_POLLING_INTERVAL_SECONDS,
  },
  [RECURRING_MATERIALIZATION_QUEUE]: {
    localConcurrency: env.JOBS_MAX_CONCURRENCY,
    pollingIntervalSeconds: env.JOBS_MAINTENANCE_POLLING_INTERVAL_SECONDS,
  },
  [RECURRING_RECONCILIATION_QUEUE]: {
    localConcurrency: 1,
    pollingIntervalSeconds: env.JOBS_MAINTENANCE_POLLING_INTERVAL_SECONDS,
  },
  [NOTIFICATION_RECONCILE_QUEUE]: {
    localConcurrency: 1,
    pollingIntervalSeconds: env.JOBS_MAINTENANCE_POLLING_INTERVAL_SECONDS,
  },
  [NOTIFICATION_CLEANUP_QUEUE]: {
    localConcurrency: 1,
    pollingIntervalSeconds: env.JOBS_MAINTENANCE_POLLING_INTERVAL_SECONDS,
  },
  [BUDGET_EVALUATE_QUEUE]: {
    localConcurrency: 1,
    pollingIntervalSeconds: env.JOBS_MAINTENANCE_POLLING_INTERVAL_SECONDS,
  },
} as const satisfies Record<JobName, JobWorkOptions>

export type SpliitBoss = PgBoss

export type BossLifecycleState = 'stopped' | 'starting' | 'running' | 'error'

export type BossLifecycle = {
  state: BossLifecycleState
  lastError: string | null
}

const lifecycleByBoss = new WeakMap<SpliitBoss, BossLifecycle>()

function lifecycleFor(boss: SpliitBoss): BossLifecycle {
  const existing = lifecycleByBoss.get(boss)
  if (existing) return existing
  const lifecycle: BossLifecycle = { state: 'stopped', lastError: null }
  lifecycleByBoss.set(boss, lifecycle)
  // PgBoss is an EventEmitter. Always install an error listener so transient
  // database failures cannot become an uncaught process-level exception.
  boss.on('error', (error) => {
    lifecycle.lastError = error instanceof Error ? error.message : String(error)
    if (lifecycle.state === 'starting') lifecycle.state = 'error'
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        component: 'pg-boss',
        message: 'pg-boss error',
        error: lifecycle.lastError,
      }),
    )
  })
  boss.on('warning', (warning) => {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warning',
        component: 'pg-boss',
        message: 'pg-boss warning',
        warning:
          warning instanceof Error ? warning.message : JSON.stringify(warning),
      }),
    )
  })
  boss.on('stopped', () => {
    lifecycle.state = 'stopped'
  })
  return lifecycle
}

export function getBossLifecycle(boss: SpliitBoss): BossLifecycle {
  const lifecycle = lifecycleFor(boss)
  return { ...lifecycle }
}

export function markBossStarting(boss: SpliitBoss): void {
  lifecycleFor(boss).state = 'starting'
}

export function markBossRunning(boss: SpliitBoss): void {
  const lifecycle = lifecycleFor(boss)
  lifecycle.state = 'running'
  lifecycle.lastError = null
}

export function markBossStopped(boss: SpliitBoss): void {
  lifecycleFor(boss).state = 'stopped'
}

async function createOrConvergeQueue(
  boss: SpliitBoss,
  name: string,
  options: Omit<Queue, 'name'>,
): Promise<void> {
  const existing = await boss.getQueue(name)
  const desiredPolicy = options.policy ?? 'standard'
  if (existing && existing.policy !== desiredPolicy) {
    throw new Error(
      `Queue ${name} uses policy ${existing.policy}; expected ${desiredPolicy}; refusing to mutate an existing queue at startup`,
    )
  }

  await boss.createQueue(name, options)
  const {
    name: _name,
    partition: _partition,
    policy: _policy,
    ...mutable
  } = {
    name,
    ...options,
  }
  await boss.updateQueue(name, mutable)
}

export async function ensureQueues(boss: SpliitBoss): Promise<void> {
  // pg-boss validates a queue's dead-letter target while creating it, so the
  // two target queues must exist before their source queues.
  await createOrConvergeQueue(boss, RECURRING_MATERIALIZATION_DLQ, {
    retentionSeconds: env.JOBS_RETENTION_SECONDS,
  })
  await createOrConvergeQueue(boss, RECURRING_RECONCILIATION_DLQ, {
    retentionSeconds: env.JOBS_RETENTION_SECONDS,
  })
  await createOrConvergeQueue(boss, NOTIFICATION_DELIVER_DLQ, {
    retentionSeconds: env.JOBS_RETENTION_SECONDS,
  })
  await createOrConvergeQueue(boss, NOTIFICATION_RECONCILE_DLQ, {
    retentionSeconds: env.JOBS_RETENTION_SECONDS,
  })
  await createOrConvergeQueue(boss, NOTIFICATION_CLEANUP_DLQ, {
    retentionSeconds: env.JOBS_RETENTION_SECONDS,
  })
  await createOrConvergeQueue(boss, BUDGET_EVALUATE_DLQ, {
    retentionSeconds: env.JOBS_RETENTION_SECONDS,
  })
  await createOrConvergeQueue(
    boss,
    RECURRING_MATERIALIZATION_QUEUE,
    JOB_QUEUE_OPTIONS[RECURRING_MATERIALIZATION_QUEUE],
  )
  await createOrConvergeQueue(
    boss,
    BUDGET_EVALUATE_QUEUE,
    JOB_QUEUE_OPTIONS[BUDGET_EVALUATE_QUEUE],
  )
  await createOrConvergeQueue(
    boss,
    RECURRING_RECONCILIATION_QUEUE,
    JOB_QUEUE_OPTIONS[RECURRING_RECONCILIATION_QUEUE],
  )
  await createOrConvergeQueue(
    boss,
    NOTIFICATION_DELIVER_QUEUE,
    JOB_QUEUE_OPTIONS[NOTIFICATION_DELIVER_QUEUE],
  )
  await createOrConvergeQueue(
    boss,
    NOTIFICATION_RECONCILE_QUEUE,
    JOB_QUEUE_OPTIONS[NOTIFICATION_RECONCILE_QUEUE],
  )
  await createOrConvergeQueue(
    boss,
    NOTIFICATION_CLEANUP_QUEUE,
    JOB_QUEUE_OPTIONS[NOTIFICATION_CLEANUP_QUEUE],
  )
}

export function createBoss(
  databaseUrl = env.DATABASE_URL,
  role: 'worker' | 'api' = 'worker',
): SpliitBoss {
  const isWorker = role === 'worker'
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema: env.PGBOSS_SCHEMA,
    // Keep a small pool reserve for pg-boss maintenance, LISTEN/NOTIFY and
    // transactional sends in addition to application job workers.
    max: isWorker
      ? Math.max(env.JOBS_POOL_SIZE, env.JOBS_MAX_CONCURRENCY + 2)
      : 2,
    application_name: isWorker ? 'spliit-worker' : 'spliit-api-jobs',
    useListenNotify: isWorker,
    schedule: isWorker,
    supervise: isWorker,
    persistWarnings: isWorker,
  })
  lifecycleFor(boss)
  return boss
}

/**
 * Start a client used by API-side enqueue calls (workers use this via
 * server.ts).
 */
export async function startBoss(
  databaseUrl = env.DATABASE_URL,
): Promise<SpliitBoss> {
  const boss = createBoss(databaseUrl)
  markBossStarting(boss)
  try {
    await boss.start()
    await ensureQueues(boss)
    markBossRunning(boss)
    return boss
  } catch (error) {
    lifecycleFor(boss).state = 'error'
    lifecycleFor(boss).lastError =
      error instanceof Error ? error.message : String(error)
    await boss.stop({ graceful: false }).catch(() => undefined)
    throw error
  }
}

/**
 * Start the API's low-footprint enqueue client without worker maintenance
 * loops.
 */
export async function startApiBoss(
  databaseUrl = env.DATABASE_URL,
): Promise<SpliitBoss> {
  const boss = createBoss(databaseUrl, 'api')
  markBossStarting(boss)
  try {
    await boss.start()
    await ensureQueues(boss)
    markBossRunning(boss)
    return boss
  } catch (error) {
    lifecycleFor(boss).state = 'error'
    lifecycleFor(boss).lastError =
      error instanceof Error ? error.message : String(error)
    await boss.stop({ graceful: false }).catch(() => undefined)
    throw error
  }
}

export async function stopBoss(boss: SpliitBoss): Promise<void> {
  await boss.stop({ graceful: true, timeout: 30_000 })
  markBossStopped(boss)
}

/** Adapt a Prisma interactive transaction for an atomic pg-boss enqueue. */
export function bossTransactionDb(tx: PrismaTransactionLike) {
  return fromPrisma(tx)
}

export function materializationSingletonKey(payload: {
  seriesId: string
  sequence: number
  occurrenceDate: string | Date
}): string {
  const occurrenceDate =
    payload.occurrenceDate instanceof Date
      ? payload.occurrenceDate.toISOString().slice(0, 10)
      : payload.occurrenceDate
  return `${payload.seriesId}:${payload.sequence}:${occurrenceDate}`
}

export function notificationDeliverSingletonKey(payload: {
  deliveryId: string
}): string {
  return payload.deliveryId
}

export async function hasDeadLetteredMaterialization(
  boss: SpliitBoss,
  payload: {
    seriesId: string
    sequence: number
    occurrenceDate: string
  },
): Promise<boolean> {
  const jobs = await boss.findJobs<JobPayload<'recurring-expense.materialize'>>(
    RECURRING_MATERIALIZATION_DLQ,
    {
      queued: true,
      key: materializationSingletonKey(payload),
      data: {
        seriesId: payload.seriesId,
        sequence: payload.sequence,
        occurrenceDate: payload.occurrenceDate,
      },
    },
  )
  return jobs.some(
    (job) =>
      job.sourceName === RECURRING_MATERIALIZATION_QUEUE &&
      job.data.seriesId === payload.seriesId &&
      job.data.sequence === payload.sequence &&
      job.data.occurrenceDate === payload.occurrenceDate,
  )
}

export async function sendJob<Name extends JobName>(
  boss: SpliitBoss,
  name: Name,
  payload: JobPayload<Name>,
  options: SendOptions = {},
) {
  const parsed = jobPayloadSchema(name).parse(payload)
  const requiredOptions: SendOptions =
    name === RECURRING_MATERIALIZATION_QUEUE
      ? {
          singletonKey: materializationSingletonKey(
            parsed as JobPayload<'recurring-expense.materialize'>,
          ),
        }
      : name === NOTIFICATION_DELIVER_QUEUE
        ? {
            singletonKey: notificationDeliverSingletonKey(
              parsed as JobPayload<'notification.deliver'>,
            ),
          }
        : {}
  return boss.send(name, parsed, {
    ...JOB_SEND_OPTIONS[name],
    ...options,
    ...requiredOptions,
  })
}

export type InsertJobsOptions = {
  db?: SendOptions['db']
}

export async function insertJobs<Name extends JobName>(
  boss: SpliitBoss,
  name: Name,
  payloads: JobPayload<Name>[],
  options: InsertJobsOptions = {},
): Promise<string[] | null> {
  if (payloads.length === 0) return null

  const schema = jobPayloadSchema(name)
  const sendOptions = JOB_SEND_OPTIONS[name]
  const jobs = payloads.map((payload) => {
    const parsed = schema.parse(payload)
    const singletonKey =
      name === RECURRING_MATERIALIZATION_QUEUE
        ? materializationSingletonKey(
            parsed as JobPayload<'recurring-expense.materialize'>,
          )
        : name === NOTIFICATION_DELIVER_QUEUE
          ? notificationDeliverSingletonKey(
              parsed as JobPayload<'notification.deliver'>,
            )
          : undefined
    return {
      data: parsed,
      ...sendOptions,
      ...(singletonKey ? { singletonKey } : {}),
    }
  })

  const result = await boss.insert(name, jobs, {
    ...(options.db ? { db: options.db } : {}),
    returnId: true,
  })
  return result as string[] | null
}

export async function scheduleJob<Name extends JobName>(
  boss: SpliitBoss,
  name: Name,
  cron: string,
  payload: JobPayload<Name>,
  options: ScheduleOptions = {},
) {
  const parsed = jobPayloadSchema(name).parse(payload)
  return boss.schedule(name, cron, parsed, {
    ...JOB_SEND_OPTIONS[name],
    ...options,
  })
}
