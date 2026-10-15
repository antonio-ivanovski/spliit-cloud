import { describe, expect, it } from 'vitest'

import {
  announcements,
  getAnnouncement,
  hasAnnouncementChannel,
  latestModalAnnouncement,
  latestUpdatesAnnouncement,
} from './announcements'

describe('announcement channels', () => {
  it('routes every entry to updates, with modal and email as opt-in channels', () => {
    expect(announcements.length).toBeGreaterThan(0)
    for (const entry of announcements) {
      expect(hasAnnouncementChannel(entry, 'updates')).toBe(true)
    }
    expect(
      announcements.some((entry) => hasAnnouncementChannel(entry, 'modal')),
    ).toBe(true)
    expect(
      announcements.some((entry) => hasAnnouncementChannel(entry, 'email')),
    ).toBe(true)
  })

  it('resolves the newest entry per channel, so quiet updates-only entries never pop the modal', () => {
    const newestUpdates = [...announcements]
      .filter((entry) => hasAnnouncementChannel(entry, 'updates'))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .at(-1)!
    const newestModal = [...announcements]
      .filter((entry) => hasAnnouncementChannel(entry, 'modal'))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .at(-1)!
    expect(latestUpdatesAnnouncement()?.id).toBe(newestUpdates.id)
    expect(latestModalAnnouncement()?.id).toBe(newestModal.id)
    expect(getAnnouncement(newestUpdates.id)?.channels).toContain('updates')
  })
})
