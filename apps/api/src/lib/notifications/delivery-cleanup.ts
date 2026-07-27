import { prisma, type Prisma } from '@spliit/db'
import { NotificationDeliveryStatus } from '@spliit/domain/notification-delivery'

const SENT_RETENTION_MS = 24 * 60 * 60 * 1000
const TERMINAL_FAILURE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const CLEANUP_BATCH_SIZE = 500

export { SENT_RETENTION_MS, TERMINAL_FAILURE_RETENTION_MS }

async function deleteInBoundedBatches(
  where: Prisma.NotificationDeliveryWhereInput,
): Promise<number> {
  let deleted = 0
  // Each pass selects at most `CLEANUP_BATCH_SIZE` eligible ids using a
  // deterministic order and deletes exactly those, so a single cleanup run
  // never issues an unbounded `deleteMany` that could hold a long
  // transaction against the table.
  for (;;) {
    const ids = await prisma.notificationDelivery.findMany({
      where,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: CLEANUP_BATCH_SIZE,
    })
    if (ids.length === 0) break
    const result = await prisma.notificationDelivery.deleteMany({
      where: { id: { in: ids.map((row) => row.id) } },
    })
    deleted += result.count
    if (ids.length < CLEANUP_BATCH_SIZE) break
  }
  return deleted
}

export async function runNotificationCleanup(): Promise<{
  sentDeleted: number
  failedDeleted: number
}> {
  const sentCutoff = new Date(Date.now() - SENT_RETENTION_MS)
  const failedCutoff = new Date(Date.now() - TERMINAL_FAILURE_RETENTION_MS)

  const sentDeleted = await deleteInBoundedBatches({
    status: NotificationDeliveryStatus.SENT,
    sentAt: { lte: sentCutoff },
  })

  const failedDeleted = await deleteInBoundedBatches({
    status: {
      in: [
        NotificationDeliveryStatus.PERMANENT_FAILURE,
        NotificationDeliveryStatus.RETRY_EXHAUSTED,
      ],
    },
    terminalAt: { lte: failedCutoff },
  })

  return { sentDeleted, failedDeleted }
}
