import { Link } from '@tanstack/react-router'
import { Megaphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { formatAnnouncementDate } from '@/components/announcement-body'
import { trpc } from '@/trpc/client'
import { getAnnouncementContent } from '@spliit/domain/announcements'
import { renderAnnouncementText } from '@spliit/domain/announcements/markdown'

/**
 * Plain-text excerpt for the landing teaser: the first paragraph of the
 * announcement body with rendered link URLs dropped for compactness.
 */
export function getLandingUpdateExcerpt(body: string): string {
  const text = renderAnnouncementText(body)
  const firstParagraph = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .find((paragraph) => !paragraph.startsWith('#'))
  if (!firstParagraph) return ''
  return firstParagraph.replace(/ \(https:\/\/[^\s)]+\)/g, '')
}

/**
 * Signed-out landing banner for the latest announcement. Renders nothing while
 * loading or when no announcements exist; the query is public so no account is
 * required.
 */
export function LandingUpdatesTeaser() {
  const { t, i18n } = useTranslation()
  const { data } = trpc.announcements.list.useQuery()
  const latestId =
    data && data.length > 0 ? data[data.length - 1]!.id : undefined
  const content = latestId
    ? getAnnouncementContent(latestId, i18n.language)
    : undefined

  if (!content) return null

  const excerpt = getLandingUpdateExcerpt(content.body)

  return (
    <section
      aria-label={t('Updates.latest')}
      data-testid="landing-updates"
      className="mt-1 w-full border-t border-border/60 pt-4"
    >
      <p className="flex items-center justify-center gap-1.5 text-xs font-medium tracking-wide text-primary uppercase lg:justify-start">
        <Megaphone className="size-3.5" aria-hidden="true" />
        {t('Updates.latest')} ·{' '}
        {formatAnnouncementDate(content.date, i18n.language)}
      </p>
      <h2 className="mt-1.5 text-base font-semibold tracking-tight">
        <Link
          to="/updates"
          hash={content.id}
          className="rounded-sm underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {content.title}
        </Link>
      </h2>
      {excerpt ? (
        <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
          {excerpt}
        </p>
      ) : null}
      <p className="mt-1.5">
        <Link
          to="/updates"
          className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('Updates.viewAll')}
        </Link>
      </p>
    </section>
  )
}
