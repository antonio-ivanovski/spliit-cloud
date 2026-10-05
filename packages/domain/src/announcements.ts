import {
  announcementContents,
  announcements,
} from './announcement-content.generated'
import {
  extractAnnouncementSections,
  renderAnnouncementHtml,
  renderAnnouncementText,
  type AnnouncementSection,
} from './announcements/markdown'
import { defaultLocale, fallbackChain, type Locale } from './i18n'

export type AnnouncementDefinition = {
  /** Stable editorial identity. A new ID represents a new announcement. */
  id: string
  /** ISO date (YYYY-MM-DD) used for ordering and display. */
  date: string
  /** English title from frontmatter; localized titles come from content. */
  title: string
  inApp: boolean
  email: boolean
}

export type Announcement = AnnouncementDefinition
export type AnnouncementId = Announcement['id']

export type LocalizedAnnouncement = AnnouncementDefinition & {
  locale: string
  title: string
  body: string
  bodyHtml: string
  sections: AnnouncementSection[]
}

function normalizeLocale(locale: string | undefined): string {
  return locale?.trim() || 'en-US'
}

export function getAnnouncementContent(
  id: string,
  locale?: string,
): LocalizedAnnouncement | undefined {
  const definition = announcements.find(
    (announcement) => announcement.id === id,
  )
  if (!definition) return undefined
  const requested = normalizeLocale(locale)
  const contents = announcementContents as Record<
    string,
    { title: string; body: string } | undefined
  >
  // Walk the locale fallback chain (e.g. pt-BR -> pt -> en-US) so sparse
  // overlay locales inherit their parent bundle instead of dropping to
  // English. Unknown locales resolve straight to the default bundle.
  const candidates = [
    requested,
    ...fallbackChain(requested as Locale),
    defaultLocale,
  ]
  let localized: { title: string; body: string } | undefined
  let resolvedLocale: string = defaultLocale
  for (const candidate of new Set(candidates)) {
    const hit = contents[`${id}:${candidate}`]
    if (hit) {
      localized = hit
      resolvedLocale = candidate
      break
    }
  }
  if (!localized) return undefined
  // Heading ids derive from the en-US source so fragments are identical in
  // every locale: a section link shared from one locale resolves in all
  // others. en-US content is required by the announcement gate, so the
  // reference is always available.
  const referenceBody =
    resolvedLocale === 'en-US'
      ? undefined
      : (contents[`${id}:en-US`] as { body: string } | undefined)?.body
  return {
    ...definition,
    locale: resolvedLocale,
    title: localized.title,
    body: localized.body,
    bodyHtml: renderAnnouncementHtml(localized.body, {
      idPrefix: id,
      referenceBody,
    }),
    sections: extractAnnouncementSections(localized.body, {
      idPrefix: id,
      referenceBody,
    }),
  }
}

export function getAnnouncement(id: string): Announcement | undefined {
  return announcements.find((announcement) => announcement.id === id)
}

export function latestInAppAnnouncement(): Announcement | undefined {
  return [...announcements].reverse().find((announcement) => announcement.inApp)
}

export function getAnnouncementTextBody(id: string): {
  title: string
  text: string
} {
  const content = getAnnouncementContent(id, 'en-US')
  if (!content) throw new Error(`Unknown announcement: ${id}`)
  return {
    title: content.title,
    text: renderAnnouncementText(content.body),
  }
}

export { announcements }
