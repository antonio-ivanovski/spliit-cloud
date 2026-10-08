import { getRouteApi, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AnnouncementBody,
  formatAnnouncementDate,
} from '@/components/announcement-body'
import { PageShell } from '@/components/layout/page-shell'
import { NotFoundPage } from '@/components/not-found-page'
import { Button } from '@/components/ui/button'
import {
  getAnnouncement,
  getAnnouncementContent,
} from '@spliit/domain/announcements'

const updateDetailRouteApi = getRouteApi('/updates/$announcementId')

export default function UpdateDetailPage() {
  const { t, i18n } = useTranslation()
  const { announcementId } = updateDetailRouteApi.useParams()
  // Announcement content is static and bundled; resolve it synchronously so
  // the page renders without a loading state. Only in-app announcements have
  // a detail page.
  const definition = getAnnouncement(announcementId)
  const content =
    definition?.inApp === true
      ? getAnnouncementContent(announcementId, i18n.language)
      : undefined
  // Section deep links (`#<id>--<section>`) point at headings inside the
  // article: scroll once it has rendered.
  useEffect(() => {
    if (!content) return
    const rawHash = window.location.hash.slice(1)
    if (!rawHash) return
    try {
      document
        .getElementById(decodeURIComponent(rawHash))
        ?.scrollIntoView({ block: 'start' })
    } catch {
      // Ignore malformed percent-encoding in the hash.
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `content` identity churns every render (locale-dependent memo); the id captures navigation between announcements.
  }, [content?.id])

  if (!content) {
    return (
      <PageShell width="full" className="py-8 sm:py-12">
        <div className="mx-auto w-full max-w-3xl">
          <NotFoundPage
            showHomeLink={false}
            actions={
              <Button
                type="button"
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link to="/updates" />}
              >
                {t('Updates.viewAll')}
              </Button>
            }
          />
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell width="full" className="py-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <p>
          <Link
            to="/updates"
            className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t('Updates.backToUpdates')}
          </Link>
        </p>
        <article className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-medium tracking-wide text-primary uppercase">
              {formatAnnouncementDate(content.date, i18n.language)}
            </p>
            <h1 className="text-3xl font-semibold">{content.title}</h1>
          </div>
          <AnnouncementBody html={content.bodyHtml} />
        </article>
      </div>
    </PageShell>
  )
}
