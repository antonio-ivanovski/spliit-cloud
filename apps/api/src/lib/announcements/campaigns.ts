import { prisma } from '@spliit/db'
import { announcements } from '@spliit/domain/announcements'

/** A reviewed campaign may specialize its lifecycle in code. */
export type CampaignHooks = {
  /** Return strictly ascending IDs after the cursor; hooks must be idempotent. */
  selectRecipients: (input: {
    afterId: string | null
    limit: number
    createdBefore: Date
  }) => Promise<Array<{ id: string }>>
  /** Lifecycle hooks must tolerate replay after a database failure. */
  beforeSend?: () => Promise<void>
  afterSend?: (result: {
    sent: number
    skipped: number
    failed: number
  }) => Promise<void>
}

/**
 * Everyone deliverable: verified email address, excluding placeholder accounts.
 * Opt-out is enforced per delivery, not at selection time, so a recipient who
 * opts out mid-campaign is skipped rather than failed.
 */
export const selectAnnouncementRecipients: CampaignHooks['selectRecipients'] = (
  input,
) =>
  prisma.user.findMany({
    where: {
      emailVerified: true,
      createdAt: { lte: input.createdBefore },
      email: { not: { endsWith: '.placeholder.local' } },
      ...(input.afterId ? { id: { gt: input.afterId } } : {}),
    },
    orderBy: { id: 'asc' },
    take: input.limit,
    select: { id: true },
  })

/** Only exceptional campaigns need server code; their definition remains shared. */
const campaignOverrides: Partial<Record<string, Partial<CampaignHooks>>> = {}

export const campaignHooks: Record<string, CampaignHooks> = Object.fromEntries(
  announcements
    .filter((announcement) => announcement.email)
    .map((announcement) => [
      announcement.id,
      {
        selectRecipients: selectAnnouncementRecipients,
        ...campaignOverrides[announcement.id],
      },
    ]),
)
