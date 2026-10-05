import { useTranslation } from 'react-i18next'

import { getAnnouncementContent } from '@spliit/domain/announcements'

import { AnnouncementBody } from './announcement-body'

export function UpdatesContent({ announcementId }: { announcementId: string }) {
  const { i18n } = useTranslation()
  const content = getAnnouncementContent(announcementId, i18n.language)
  if (!content) return null
  return <AnnouncementBody html={content.bodyHtml} />
}
