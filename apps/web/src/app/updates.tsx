import { Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AnnouncementBody,
  formatAnnouncementDate,
} from '@/components/announcement-body'
import { PageShell } from '@/components/layout/page-shell'
import { trpc } from '@/trpc/client'
import { getAnnouncementContent } from '@spliit/domain/announcements'

import { getLandingUpdateExcerpt } from './landing-updates'

export default function UpdatesPage() {
  const { t, i18n } = useTranslation()
  const { data } = trpc.announcements.list.useQuery()
  const entries = [...(data ?? [])]
    .reverse()
    .map((entry) => getAnnouncementContent(entry.id, i18n.language))
    .filter((entry) => entry !== undefined)
  const [latest, ...older] = entries
  // Section deep links (`#<id>--<section>`) must wait for the async query:
  // scroll once the latest entry has rendered.
  useEffect(() => {
    if (!latest) return
    const rawHash = window.location.hash.slice(1)
    if (!rawHash) return
    try {
      document
        .getElementById(decodeURIComponent(rawHash))
        ?.scrollIntoView({ block: 'start' })
    } catch {
      // Ignore malformed percent-encoding in the hash.
    }
    // Entries only grow from empty to loaded; the array identity changes every
    // render, so depend on the count to run this once after load.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `latest` identity churns every render; the count captures the empty-to-loaded transition.
  }, [entries.length])
  return (
    <PageShell width="full" className="py-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <h1 className="text-3xl font-semibold">{t('Updates.title')}</h1>
        {latest ? (
          <article
            key={latest.id}
            id={latest.id}
            className="scroll-mt-4 space-y-3"
          >
            <div className="space-y-1">
              <p className="text-xs font-medium tracking-wide text-primary uppercase">
                {t('Updates.latest')} ·{' '}
                {formatAnnouncementDate(latest.date, i18n.language)}
              </p>
              <h2 className="text-2xl font-semibold">{latest.title}</h2>
            </div>
            <AnnouncementBody html={latest.bodyHtml} />
          </article>
        ) : null}
        {older.length > 0 ? (
          <section aria-label={t('Updates.archive')} className="space-y-4">
            <h2 className="text-xl font-semibold">{t('Updates.archive')}</h2>
            <ul className="space-y-5">
              {older.map((announcement) => (
                <li key={announcement.id} className="space-y-1">
                  <p className="text-xs font-medium tracking-wide text-primary uppercase">
                    {formatAnnouncementDate(announcement.date, i18n.language)}
                  </p>
                  <h3 className="text-lg font-semibold">
                    <Link
                      to="/updates/$announcementId"
                      params={{ announcementId: announcement.id }}
                      className="rounded-sm underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {announcement.title}
                    </Link>
                  </h3>
                  <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
                    {getLandingUpdateExcerpt(announcement.body)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </PageShell>
  )
}
