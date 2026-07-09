import { exchangeRateLookupDate, utcTodayIso } from './conversion'

describe('exchangeRateLookupDate', () => {
  it('returns the expense date when it is today or in the past', () => {
    expect(exchangeRateLookupDate('2026-06-01', '2026-07-09')).toBe(
      '2026-06-01',
    )
    expect(exchangeRateLookupDate('2026-07-09', '2026-07-09')).toBe(
      '2026-07-09',
    )
  })

  it('returns today when the expense date is in the future', () => {
    expect(exchangeRateLookupDate('2026-12-31', '2026-07-09')).toBe(
      '2026-07-09',
    )
  })
})

describe('utcTodayIso', () => {
  it('formats a UTC calendar date as YYYY-MM-DD', () => {
    expect(utcTodayIso(new Date('2026-07-09T23:30:00.000Z'))).toBe('2026-07-09')
  })
})
