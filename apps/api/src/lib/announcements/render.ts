import {
  getAnnouncementContent,
  type Announcement,
} from '@spliit/domain/announcements'
import { renderAnnouncementText } from '@spliit/domain/announcements/markdown'

import { renderAnnouncementEmailTemplate } from '../mail/templates/announcement'

/**
 * Render the announcement email in the shared branded container.
 *
 * Body copy stays identical to the text version (same EN Markdown source as
 * in-app); the HTML is produced by the react-email `AnnouncementEmail` template
 * inside `EmailLayout`, so it carries the logo header, card styling, "See all
 * updates" CTA, and the standard unsubscribe footer.
 */
export async function renderAnnouncementEmail(input: {
  announcement: Announcement
  webBaseUrl: string
  unsubscribeUrl: string
}): Promise<{ subject: string; text: string; html: string }> {
  const content = getAnnouncementContent(input.announcement.id, 'en-US')
  if (!content)
    throw new Error(`Unknown announcement: ${input.announcement.id}`)
  const { title, body } = content
  // Deep-link straight to the announcement so email readers land on it.
  // The /updates page scrolls to the hash once entries have loaded.
  const updatesUrl = `${input.webBaseUrl}/updates#${input.announcement.id}`
  const text = [
    title,
    '',
    renderAnnouncementText(body).trim(),
    '',
    `See all updates: ${updatesUrl}`,
    '',
    `Turn off these emails: ${input.unsubscribeUrl}`,
  ].join('\n')
  return renderAnnouncementEmailTemplate({
    subject: title,
    text,
    title,
    body,
    brandBaseUrl: input.webBaseUrl,
    updatesUrl,
    unsubscribeUrl: input.unsubscribeUrl,
  })
}
