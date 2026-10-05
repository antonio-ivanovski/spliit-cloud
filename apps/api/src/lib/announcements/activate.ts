import { prisma } from '@spliit/db'
import { announcements } from '@spliit/domain/announcements'

import { env } from '../env'

/**
 * Register explicit Cloud email campaigns once, after migrations and before
 * serving.
 */
export async function activateAnnouncementCampaigns(): Promise<void> {
  if (!env.CLOUD_NEWS_ENABLED) return

  const campaigns = announcements.filter((announcement) => announcement.email)
  if (campaigns.length === 0) return
  await prisma.announcementCampaign.createMany({
    data: campaigns.map((announcement) => ({ id: announcement.id })),
    skipDuplicates: true,
  })
}
