import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AnnouncementBody,
  formatAnnouncementDate,
} from '@/components/announcement-body'
import { PageShell } from '@/components/layout/page-shell'
import { trpc } from '@/trpc/client'
import { getAnnouncementContent } from '@spliit/domain/announcements'

export default function UpdatesPage() {
  const { t, i18n } = useTranslation()
  const { data } = trpc.announcements.list.useQuery()
  const entries = [...(data ?? [])]
    .reverse()
    .map((entry) => getAnnouncementContent(entry.id, i18n.language))
    .filter((entry) => entry !== undefined)
  // Deep links (`/updates#<announcement-id>` or `#<id>--<section>`) must wait
  // for the async query: scroll once entries have rendered.
  useEffect(() => {
    if (entries.length === 0) return
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length])
  return (
    <PageShell width="full" className="py-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <h1 className="text-3xl font-semibold">{t('Updates.title')}</h1>
        {entries.map((announcement) => (
          <article
            key={announcement.id}
            id={announcement.id}
            className="scroll-mt-4 space-y-3"
          >
            <div className="space-y-1">
              <p className="text-xs font-medium tracking-wide text-primary uppercase">
                {formatAnnouncementDate(announcement.date, i18n.language)}
              </p>
              <h2 className="text-2xl font-semibold">
                <a
                  href={`#${announcement.id}`}
                  className="rounded-sm decoration-primary/40 underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {announcement.title}
                </a>
              </h2>
            </div>
            <AnnouncementBody html={announcement.bodyHtml} />
          </article>
        ))}
      </div>
    </PageShell>
  )
}
