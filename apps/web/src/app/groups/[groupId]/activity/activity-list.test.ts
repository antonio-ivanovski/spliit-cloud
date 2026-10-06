import { describe, expect, it } from 'vitest'

import {
  getGroupedActivitiesByDate,
  splitActivityRuns,
} from './activity-grouping'

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

describe('splitActivityRuns', () => {
  it('groups consecutive same-visibility activities into runs', () => {
    const runs = splitActivityRuns(
      ['a', 'b', 'c', 'd', 'e'],
      (item) => item === 'a' || item === 'c' || item === 'e',
    )
    expect(runs).toEqual([
      { type: 'visible', items: ['a'] },
      { type: 'hidden', items: ['b'] },
      { type: 'visible', items: ['c'] },
      { type: 'hidden', items: ['d'] },
      { type: 'visible', items: ['e'] },
    ])
  })

  it('merges adjacent same-visibility activities into one run', () => {
    const runs = splitActivityRuns(['a', 'b', 'c'], () => true)
    expect(runs).toEqual([{ type: 'visible', items: ['a', 'b', 'c'] }])
  })

  it('returns no runs for an empty list', () => {
    expect(splitActivityRuns([], () => true)).toEqual([])
  })
})
