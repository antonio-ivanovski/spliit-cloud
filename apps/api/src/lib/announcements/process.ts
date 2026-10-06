import { prisma } from '@spliit/db'
import { getAnnouncement } from '@spliit/domain/announcements'
import {
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'

import { randomId } from '../api/shared'
import { getWebBaseUrl } from '../auth/urls'
import { env, isEmailDeliveryEnabled } from '../env'
import { sendEmail } from '../mail/send'
import { classifyEmailError } from '../notifications/email-delivery-sender'
import { buildEmailUnsubscribeMetadata } from '../notifications/unsubscribe'
import { campaignHooks } from './campaigns'
import { renderAnnouncementEmail } from './render'

const PAGE_SIZE = 500
const SEND_BATCH_SIZE = 10
const MAX_ATTEMPTS = 5

/**
 * Validate one keyset page before writing deliveries. This must stay
 * collation-agnostic: account ids are mixed-case alphanumeric (better-auth),
 * and Postgres `ORDER BY id` / `id > cursor` use the database collation while
 * JS `<`/`<=` compare UTF-16 code units. On typical `en_US.UTF-8` databases
 * those orders disagree (e.g. `B < a` in JS but `a < B` in a case-insensitive
 * collation), so a binary sortedness check rejects perfectly good pages. Keyset
 * pagination is self-consistent in the database's own ordering, so here we only
 * guard against what would loop forever or duplicate work: oversized pages,
 * duplicates within the page, and the previous cursor reappearing (the query
 * uses `id > cursor`, so it must not).
 */
export function assertValidAudiencePage(
  recipients: Array<{ id: string }>,
  cursor: string | null,
  campaignId: string,
): void {
  if (recipients.length > PAGE_SIZE) {
    throw new Error(`Invalid audience page for ${campaignId}`)
  }
  const seen = new Set<string>()
  for (const recipient of recipients) {
    if (seen.has(recipient.id) || recipient.id === cursor) {
      throw new Error(`Invalid audience page for ${campaignId}`)
    }
    seen.add(recipient.id)
  }
}

async function sendOne(deliveryId: string) {
  const claimed = await prisma.announcementEmailDelivery.updateMany({
    where: { id: deliveryId, status: { in: ['PENDING', 'RETRY'] } },
    data: { status: 'PROCESSING', attempts: { increment: 1 } },
  })
  if (claimed.count !== 1) return

  const delivery = await prisma.announcementEmailDelivery.findUniqueOrThrow({
    where: { id: deliveryId },
  })
  const announcement = getAnnouncement(delivery.campaignId)
  const account = await prisma.user.findUnique({
    where: { id: delivery.accountId },
    select: {
      email: true,
      emailVerified: true,
      notificationPreferences: {
        where: { category: NotificationCategory.PRODUCT_UPDATES },
        select: { channels: true },
      },
    },
  })
  const optedOut =
    account?.notificationPreferences[0] &&
    !account.notificationPreferences[0].channels.includes(
      NotificationChannel.EMAIL,
    )
  if (
    !account?.emailVerified ||
    account.email.endsWith('.placeholder.local') ||
    optedOut ||
    !announcement?.email ||
    !env.CLOUD_NEWS_ENABLED
  ) {
    await prisma.announcementEmailDelivery.update({
      where: { id: deliveryId },
      data: { status: 'SKIPPED' },
    })
    return
  }

  try {
    const unsubscribe = await buildEmailUnsubscribeMetadata({
      accountId: delivery.accountId,
      category: NotificationCategory.PRODUCT_UPDATES,
    })
    if (!unsubscribe) throw new Error('Unsubscribe metadata unavailable')
    const { subject, text, html } = await renderAnnouncementEmail({
      announcement,
      webBaseUrl: getWebBaseUrl(),
      unsubscribeUrl: unsubscribe.url,
    })
    await sendEmail({
      to: account.email,
      subject,
      text,
      html,
      headers: {
        // No Message-ID: Cloudflare generates it and rejects the whole
        // request when callers set platform-controlled headers. The
        // delivery id stays traceable via an allowed X- header instead.
        'X-Spliit-Delivery-Id': delivery.id,
        'List-Unsubscribe': unsubscribe.headers['List-Unsubscribe'],
        'List-Unsubscribe-Post': unsubscribe.headers['List-Unsubscribe-Post'],
      },
    })
    await prisma.announcementEmailDelivery.update({
      where: { id: deliveryId },
      data: { status: 'SENT', sentAt: new Date(), lastError: null },
    })
  } catch (error) {
    // Permanent provider rejections (bad address, disabled sending) fail
    // fast instead of burning all attempts on retries that cannot succeed.
    const permanent =
      classifyEmailError(error) === 'permanent' ||
      delivery.attempts >= MAX_ATTEMPTS
    await prisma.announcementEmailDelivery.update({
      where: { id: deliveryId },
      data: {
        status: permanent ? 'FAILED' : 'RETRY',
        lastError:
          error instanceof Error
            ? error.message.slice(0, 500)
            : String(error).slice(0, 500),
      },
    })
  }
}

export async function processAnnouncementCampaigns(): Promise<void> {
  if (!env.CLOUD_NEWS_ENABLED || !isEmailDeliveryEnabled()) return
  const campaigns = await prisma.announcementCampaign.findMany({
    where: { status: { in: ['PLANNING', 'SENDING'] } },
    orderBy: { createdAt: 'asc' },
  })
  for (const campaign of campaigns) {
    const hooks = campaignHooks[campaign.id]
    if (!hooks) continue
    if (campaign.status === 'PLANNING') {
      if (!campaign.preparedAt) {
        await hooks.beforeSend?.()
        await prisma.announcementCampaign.update({
          where: { id: campaign.id },
          data: { preparedAt: new Date() },
        })
      }
      const recipients = await hooks.selectRecipients({
        afterId: campaign.cursor,
        limit: PAGE_SIZE,
        createdBefore: campaign.createdAt,
      })
      assertValidAudiencePage(recipients, campaign.cursor, campaign.id)
      await prisma.announcementEmailDelivery.createMany({
        data: recipients.map((account) => ({
          id: randomId(),
          campaignId: campaign.id,
          accountId: account.id,
        })),
        skipDuplicates: true,
      })
      await prisma.announcementCampaign.update({
        where: { id: campaign.id },
        data: {
          cursor: recipients.at(-1)?.id ?? campaign.cursor,
          status: recipients.length < PAGE_SIZE ? 'SENDING' : 'PLANNING',
        },
      })
      continue
    }
    await prisma.announcementEmailDelivery.updateMany({
      where: {
        campaignId: campaign.id,
        status: 'PROCESSING',
        updatedAt: { lt: new Date(Date.now() - 10 * 60_000) },
      },
      data: { status: 'RETRY' },
    })
    const pending = await prisma.announcementEmailDelivery.findMany({
      where: {
        campaignId: campaign.id,
        OR: [
          { status: 'PENDING' },
          {
            status: 'RETRY',
            updatedAt: { lt: new Date(Date.now() - 5 * 60_000) },
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: SEND_BATCH_SIZE,
      select: { id: true },
    })
    for (const delivery of pending) await sendOne(delivery.id)
    const remaining = await prisma.announcementEmailDelivery.count({
      where: {
        campaignId: campaign.id,
        status: { in: ['PENDING', 'RETRY', 'PROCESSING'] },
      },
    })
    if (remaining === 0) {
      const counts = await Promise.all(
        ['SENT', 'SKIPPED', 'FAILED'].map((status) =>
          prisma.announcementEmailDelivery.count({
            where: { campaignId: campaign.id, status },
          }),
        ),
      )
      await hooks.afterSend?.({
        sent: counts[0]!,
        skipped: counts[1]!,
        failed: counts[2]!,
      })
      await prisma.announcementCampaign.update({
        where: { id: campaign.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })
    }
  }
}
