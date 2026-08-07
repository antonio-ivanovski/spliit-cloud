import { describe, expect, it } from 'vitest'

import { getGroupedActivitiesByDate } from './activity-grouping'

describe('activity timeline grouping', () => {
  it('uses the locale week start for earlier-this-week and last-week buckets', () => {
    const sunday = { id: 'sunday', time: new Date('2026-08-02T12:00:00.000Z') }
    const now = new Date('2026-08-06T12:00:00.000Z')

    expect(
      getGroupedActivitiesByDate([sunday], 'UTC', 'en-US', now).earlierThisWeek,
    ).toHaveLength(1)
    expect(
      getGroupedActivitiesByDate([sunday], 'UTC', 'de-DE', now).lastWeek,
    ).toHaveLength(1)
  })
})
