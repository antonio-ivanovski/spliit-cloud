import { prisma } from '@spliit/db'
import { NotificationDeliveryStatus } from '@spliit/domain/notification-delivery'
import { env, getBossLifecycle, JOB_NAMES, type SpliitBoss } from '@spliit/jobs'

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

type TransportStats = {
  oldestRunnableMs: number | null
  overdue: number
  futureBackoff: number
  transportJobs: number
  missingTransport: number
}

async function queryTransportStats(): Promise<TransportStats> {
  const schema = env.PGBOSS_SCHEMA
  const queue = JOB_NAMES.NOTIFICATION_DELIVER
  const [aggRows, missingRows] = await Promise.all([
    prisma.$queryRawUnsafe<
      Array<{
        oldest_runnable_ms: number | null
        overdue: bigint
        future_backoff: bigint
        transport_jobs: bigint
      }>
    >(
      `SELECT
         EXTRACT(EPOCH FROM (now() - min(j.start_after) FILTER (WHERE j.state IN ('created', 'retry') AND j.start_after <= now()))) * 1000 AS oldest_runnable_ms,
         count(*) FILTER (WHERE j.state IN ('created', 'retry') AND j.start_after <= now()) AS overdue,
         count(*) FILTER (WHERE j.state IN ('created', 'retry') AND j.start_after > now()) AS future_backoff,
         count(*) AS transport_jobs
       FROM "${schema}".job j
       WHERE j.name = $1
         AND j.state IN ('created', 'retry', 'active')`,
      queue,
    ),
    prisma.$queryRawUnsafe<Array<{ missing: bigint }>>(
      `SELECT count(*) AS missing
       FROM "NotificationDelivery" d
       WHERE d.status IN ('PENDING', 'PROCESSING')
         AND NOT EXISTS (
           SELECT 1
           FROM "${schema}".job j
           WHERE j.name = $1
             AND j.singleton_key = d.id
             AND j.state IN ('created', 'retry', 'active')
         )`,
      queue,
    ),
  ])
  const agg = aggRows[0]
  const missing = missingRows[0]
  return {
    oldestRunnableMs:
      agg?.oldest_runnable_ms != null ? Number(agg.oldest_runnable_ms) : null,
    overdue: Number(agg?.overdue ?? 0),
    futureBackoff: Number(agg?.future_backoff ?? 0),
    transportJobs: Number(agg?.transport_jobs ?? 0),
    missingTransport: Number(missing?.missing ?? 0),
  }
}

async function getDeliveryHealth(_boss: SpliitBoss) {
  const [
    pending,
    processing,
    permanent,
    exhausted,
    sent,
    activeLeases,
    expiredLeases,
    transport,
  ] = await Promise.all([
    prisma.notificationDelivery.count({
      where: { status: NotificationDeliveryStatus.PENDING },
    }),
    prisma.notificationDelivery.count({
      where: { status: NotificationDeliveryStatus.PROCESSING },
    }),
    prisma.notificationDelivery.count({
      where: { status: NotificationDeliveryStatus.PERMANENT_FAILURE },
    }),
    prisma.notificationDelivery.count({
      where: { status: NotificationDeliveryStatus.RETRY_EXHAUSTED },
    }),
    prisma.notificationDelivery.count({
      where: { status: NotificationDeliveryStatus.SENT },
    }),
    prisma.notificationDelivery.count({
      where: {
        status: NotificationDeliveryStatus.PROCESSING,
        leaseExpiresAt: { gt: new Date() },
      },
    }),
    prisma.notificationDelivery.count({
      where: {
        status: NotificationDeliveryStatus.PROCESSING,
        leaseExpiresAt: { lte: new Date() },
      },
    }),
    queryTransportStats(),
  ])

  const lagUnhealthy =
    transport.oldestRunnableMs != null &&
    transport.oldestRunnableMs > env.HEALTH_RUNNABLE_LAG_THRESHOLD_MS
  const transportUnhealthy =
    transport.missingTransport > env.HEALTH_MISSING_TRANSPORT_THRESHOLD

  return {
    healthy: !lagUnhealthy && !transportUnhealthy,
    pending,
    processing,
    activeLeases,
    expiredLeases,
    permanentFailure: permanent,
    retryExhausted: exhausted,
    sent,
    transport: {
      oldestRunnableMs: transport.oldestRunnableMs,
      overdue: transport.overdue,
      futureBackoff: transport.futureBackoff,
      missingTransport: transport.missingTransport,
    },
    thresholds: {
      runnableLagMs: env.HEALTH_RUNNABLE_LAG_THRESHOLD_MS,
      missingTransport: env.HEALTH_MISSING_TRANSPORT_THRESHOLD,
    },
  }
}

export function createAdminFetch(
  boss: SpliitBoss,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const url = new URL(request.url)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    if (url.pathname === '/health' || url.pathname === '/health/liveness') {
      return json({ status: 'healthy' })
    }
    if (url.pathname === '/health/readiness') {
      try {
        const lifecycle = getBossLifecycle(boss)
        const installed =
          lifecycle.state === 'running' && (await boss.isInstalled())
        const delivery = await getDeliveryHealth(boss)
        const healthy = installed && delivery.healthy
        return json(
          {
            status: healthy ? 'healthy' : 'unhealthy',
            boss: lifecycle.state,
            delivery,
            ...(lifecycle.lastError ? { error: lifecycle.lastError } : {}),
          },
          healthy ? 200 : 503,
        )
      } catch (error) {
        return json(
          {
            status: 'unhealthy',
            error: error instanceof Error ? error.message : String(error),
          },
          503,
        )
      }
    }
    return new Response('Not found', { status: 404 })
  }
}

export async function createDisabledHealthFetch(
  request: Request,
): Promise<Response> {
  const url = new URL(request.url)
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  if (
    url.pathname === '/health' ||
    url.pathname === '/health/liveness' ||
    url.pathname === '/health/readiness'
  ) {
    return json({ status: 'healthy', jobs: 'disabled' })
  }
  return new Response('Not found', { status: 404 })
}
