import { describe, expect, it } from 'vitest'

import { formatIsoDate, todayInTimeZone } from './dates'

describe('report dates', () => {
  it('uses the browser time zone calendar date', () => {
    const now = new Date('2026-08-03T00:30:00.000Z')

    expect(formatIsoDate(todayInTimeZone('America/Los_Angeles', now))).toBe(
      '2026-08-02',
    )
    expect(formatIsoDate(todayInTimeZone('Asia/Tokyo', now))).toBe('2026-08-03')
  })

  it('falls back to UTC for an invalid time zone', () => {
    const now = new Date('2026-08-03T00:30:00.000Z')

    expect(formatIsoDate(todayInTimeZone('Not/AZone', now))).toBe('2026-08-03')
  })
})
