import { prisma } from '@spliit/db'
import { NotificationDeliveryStatus } from '@spliit/domain/notification-delivery'
import { JOB_NAMES, sendJob, type SpliitBoss } from '@spliit/jobs'

const RECONCILE_BATCH_SIZE = 100
// Upper bound on how many rows a single run examines before returning a
// cursor for a follow-up run. Counts every examined row (not just newly
// enqueued jobs) so a table full of healthy rows whose singleton jobs
// already exist cannot cause an unbounded scan.
const RECONCILE_SCAN_LIMIT = 1000

export async function reconcileMissingDeliveryJobs(
  boss: SpliitBoss,
  args: { cursor?: string | null } = {},
): Promise<{ reconciled: number; scanned: number; nextCursor: string | null }> {
  let cursor = args.cursor ?? null
  let reconciled = 0
  let scanned = 0
  let exhausted = false
  for (;;) {
    const deliveries = await prisma.notificationDelivery.findMany({
      where: {
        status: {
          in: [
            NotificationDeliveryStatus.PENDING,
            NotificationDeliveryStatus.PROCESSING,
          ],
        },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: RECONCILE_BATCH_SIZE,
    })
    if (deliveries.length === 0) {
      exhausted = true
      break
    }
    for (const delivery of deliveries) {
      scanned++
      const jobId = await sendJob(
        boss,
        JOB_NAMES.NOTIFICATION_DELIVER,
        { deliveryId: delivery.id },
        { singletonKey: delivery.id },
      )
      if (jobId) reconciled++
    }
    cursor = deliveries[deliveries.length - 1]!.id
    if (deliveries.length < RECONCILE_BATCH_SIZE) {
      exhausted = true
      break
    }
    if (scanned >= RECONCILE_SCAN_LIMIT) break
  }
  return { reconciled, scanned, nextCursor: exhausted ? null : cursor }
}
