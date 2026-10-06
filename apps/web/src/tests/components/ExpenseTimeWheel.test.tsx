import { describe, expect, it } from 'vitest'

import {
  getDayPeriodLabels,
  isTwelveHourLocale,
  QUICK_TIME_MINUTES,
} from '@/app/groups/[groupId]/expenses/expense-form/expense-time-wheel'

describe('isTwelveHourLocale', () => {
  it('detects 12-hour locales', () => {
    expect(isTwelveHourLocale('en-US')).toBe(true)
  })

  it('detects 24-hour locales', () => {
    expect(isTwelveHourLocale('de-DE')).toBe(false)
    expect(isTwelveHourLocale('mk-MK')).toBe(false)
  })
})

describe('getDayPeriodLabels', () => {
  it('returns localized day periods', () => {
    const { am, pm } = getDayPeriodLabels('en-US')
    expect(am).toMatch(/AM/i)
    expect(pm).toMatch(/PM/i)
  })
})

describe('QUICK_TIME_MINUTES', () => {
  it('uses fixed wall-clock shortcuts', () => {
    expect(QUICK_TIME_MINUTES).toEqual({
      morning: 540,
      midday: 720,
      evening: 1140,
    })
  })
})
