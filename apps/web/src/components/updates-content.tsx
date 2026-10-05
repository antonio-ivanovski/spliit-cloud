import { useTranslation } from 'react-i18next'

import { getAnnouncementContent } from '@spliit/domain/announcements'

import { AnnouncementBody } from './announcement-body'

export function UpdatesContent({ announcementId }: { announcementId: string }) {
  const { i18n } = useTranslation()
  // No heading anchors in the modal: fragment links belong to the /updates
  // page, where sections are directly navigable.
  const content = getAnnouncementContent(announcementId, i18n.language, {
    anchors: false,
  })
  if (!content) return null
  return <AnnouncementBody html={content.bodyHtml} />
}
