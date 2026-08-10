import { describe, expect, it } from 'vitest'

import {
  formatNotificationAmount,
  formatNotificationDate,
  formatNotificationNumber,
  formatNotificationPercent,
} from './format'

describe('notification formatting', () => {
  it('uses recipient locale and currency precision', () => {
    expect(formatNotificationAmount(123456, 'EUR', 'de-DE')).toContain(
      '1.234,56',
    )
    expect(formatNotificationAmount(1000, 'JPY', 'en-US')).toContain('¥1,000')
  })

  it('formats dates and counts with the recipient locale', () => {
    expect(formatNotificationDate('2026-08-02', 'de-DE')).toContain(
      '02.08.2026',
    )
    expect(formatNotificationNumber(1234567, 'ar-SA')).not.toBe('1234567')
    expect(formatNotificationPercent(45, 'de-DE')).toContain('%')
  })

  it('falls back safely for malformed locale metadata', () => {
    expect(formatNotificationNumber(1234.5, 'not-a-locale')).toContain(
      '1,234.5',
    )
  })
})
