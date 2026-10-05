#!/usr/bin/env bun
import { writeFileSync } from 'node:fs'

import { renderAnnouncementEmail } from '../apps/api/src/lib/announcements/render'
import { getAnnouncement } from '../packages/domain/src/announcements'

const id = process.argv[2]
const htmlPath = process.argv[3] ?? '/tmp/spliit-announcement-preview.html'
const announcement = id ? getAnnouncement(id) : undefined
if (!announcement || process.argv.length > 4) {
  throw new Error('Usage: bun scripts/preview-announcement.ts <id> [html-path]')
}
const preview = await renderAnnouncementEmail({
  announcement,
  webBaseUrl: 'https://spliit.cloud',
  unsubscribeUrl: 'https://api.spliit.cloud/email/unsubscribe?token=PREVIEW',
})
writeFileSync(htmlPath, preview.html)
process.stdout.write(
  `Subject: ${preview.subject}\n\n${preview.text}\n\nHTML: ${htmlPath}\n`,
)
