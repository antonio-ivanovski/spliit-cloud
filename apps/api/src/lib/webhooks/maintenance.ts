import { prisma } from '@spliit/db'
import { WebhookDeliveryStatus } from '@spliit/domain/webhooks'
import { JOB_NAMES, sendJob, type SpliitBoss } from '@spliit/jobs'

const SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const FAILURE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export async function reconcileWebhookDeliveries(
  boss: SpliitBoss,
  cursor?: string | null,
) {
  const stale = await prisma.webhookDelivery.findMany({
    where: {
      status: WebhookDeliveryStatus.PROCESSING,
      lastAttemptAt: { lte: new Date(Date.now() - 5 * 60 * 1000) },
    },
    select: { id: true },
  })
  if (stale.length > 0) {
    const staleIds = stale.map((row) => row.id)
    const finishedAt = new Date()
    await prisma.$transaction([
      prisma.webhookDelivery.updateMany({
        where: {
          id: { in: staleIds },
          status: WebhookDeliveryStatus.PROCESSING,
        },
        data: {
          status: WebhookDeliveryStatus.PENDING,
          lastErrorCode: 'STALE_ATTEMPT',
          lastErrorMessage: 'Recovered an interrupted delivery attempt',
        },
      }),
      // Close attempt rows abandoned by the interrupted worker so history does
      // not count them as still running.
      prisma.webhookDeliveryAttempt.updateMany({
        where: { deliveryId: { in: staleIds }, finishedAt: null },
        data: { finishedAt, outcome: 'RETRYING' },
      }),
    ])
  }
  const rows = await prisma.webhookDelivery.findMany({
    where: { status: WebhookDeliveryStatus.PENDING },
    orderBy: { id: 'asc' },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: 200,
    select: { id: true },
  })
  for (const row of rows) {
    await sendJob(boss, JOB_NAMES.WEBHOOK_DELIVER, { deliveryId: row.id })
  }
  return {
    reconciled: rows.length,
    nextCursor: rows.length === 200 ? (rows.at(-1)?.id ?? null) : null,
  }
}

export async function cleanupWebhookDeliveries() {
  const now = Date.now()
  const [sent, failed] = await prisma.$transaction([
    prisma.webhookDelivery.deleteMany({
      where: {
        status: WebhookDeliveryStatus.SENT,
        terminalAt: { lte: new Date(now - SENT_RETENTION_MS) },
      },
    }),
    prisma.webhookDelivery.deleteMany({
      where: {
        status: {
          in: [
            WebhookDeliveryStatus.PERMANENT_FAILURE,
            WebhookDeliveryStatus.RETRY_EXHAUSTED,
            WebhookDeliveryStatus.CANCELED,
          ],
        },
        terminalAt: { lte: new Date(now - FAILURE_RETENTION_MS) },
      },
    }),
  ])
  await prisma.webhookEvent.deleteMany({
    where: { deliveries: { none: {} } },
  })
  return { sentDeleted: sent.count, failedDeleted: failed.count }
}
