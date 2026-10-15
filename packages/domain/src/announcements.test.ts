import { describe, expect, it } from 'vitest'

import {
  announcements,
  getAnnouncement,
  hasAnnouncementChannel,
  latestModalAnnouncement,
  latestUpdatesAnnouncement,
} from './announcements'

describe('announcement channels', () => {
  it('routes existing entries to all three channels', () => {
    expect(announcements.length).toBeGreaterThan(0)
    for (const entry of announcements) {
      expect(hasAnnouncementChannel(entry, 'updates')).toBe(true)
      expect(hasAnnouncementChannel(entry, 'modal')).toBe(true)
      expect(hasAnnouncementChannel(entry, 'email')).toBe(true)
    }
  })

  it('resolves the newest entry for both the updates list and the modal', () => {
    const sorted = [...announcements].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    )
    const newest = sorted.at(-1)!
    expect(latestUpdatesAnnouncement()?.id).toBe(newest.id)
    expect(latestModalAnnouncement()?.id).toBe(newest.id)
    expect(getAnnouncement(newest.id)?.channels).toContain('updates')
  })
})
