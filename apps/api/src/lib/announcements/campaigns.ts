import { prisma } from '@spliit/db'
import {
  announcements,
  announcementPublicationStart,
  hasAnnouncementChannel,
  type Announcement,
} from '@spliit/domain/announcements'

export type SelectRecipientsInput = {
  afterId: string | null
  limit: number
  createdBefore: Date
}

/** A reviewed campaign may specialize its lifecycle in code. */
export type CampaignHooks = {
  /** Return strictly ascending IDs after the cursor; hooks must be idempotent. */
  selectRecipients: (
    input: SelectRecipientsInput,
  ) => Promise<Array<{ id: string }>>
  /** Lifecycle hooks must tolerate replay after a database failure. */
  beforeSend?: () => Promise<void>
  afterSend?: (result: {
    sent: number
    skipped: number
    failed: number
  }) => Promise<void>
}

/**
 * Everyone deliverable: verified email address, excluding placeholder accounts
 * and accounts registered on or after the announcement's publication day.
 * Opt-out is enforced per delivery, not at selection time, so a recipient who
 * opts out mid-campaign is skipped rather than failed.
 */
export const selectAnnouncementRecipients = (
  announcement: Announcement,
  input: SelectRecipientsInput,
) =>
  prisma.user.findMany({
    where: {
      emailVerified: true,
      // Snapshot at campaign creation, then drop accounts that are newer than
      // the announcement itself. Frontmatter dates are date-only, so the
      // publication cutoff is 00:00 UTC on that day.
      createdAt: {
        lt: announcementPublicationStart(announcement),
        lte: input.createdBefore,
      },
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
    .filter((announcement) => hasAnnouncementChannel(announcement, 'email'))
    .map((announcement) => [
      announcement.id,
      {
        selectRecipients: (input: SelectRecipientsInput) =>
          selectAnnouncementRecipients(announcement, input),
        ...campaignOverrides[announcement.id],
      },
    ]),
)
