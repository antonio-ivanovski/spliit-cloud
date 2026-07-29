import {
  dateOnlyInTimeZone,
  isValidTimeZone,
  occurrenceDateToUtcRunAt,
  timeZoneSchema,
} from './timezones'

describe('timeZoneSchema', () => {
  it('accepts UTC and IANA timezones', () => {
    expect(timeZoneSchema.parse('UTC')).toBe('UTC')
    expect(timeZoneSchema.parse('Europe/Skopje')).toBe('Europe/Skopje')
    expect(isValidTimeZone('America/New_York')).toBe(true)
  })

  it('rejects unknown timezones', () => {
    expect(timeZoneSchema.safeParse('').success).toBe(false)
    expect(timeZoneSchema.safeParse('Europe/Not_A_City').success).toBe(false)
  })
})

describe('occurrenceDateToUtcRunAt', () => {
  it('schedules 15:00 UTC for UTC ledgers', () => {
    expect(occurrenceDateToUtcRunAt('2026-07-29', 'UTC').toISOString()).toBe(
      '2026-07-29T15:00:00.000Z',
    )
  })

  it('uses UTC date components for Prisma DATE values', () => {
    expect(
      occurrenceDateToUtcRunAt(
        new Date('2026-07-29T00:00:00.000Z'),
        'Asia/Tokyo',
      ).toISOString(),
    ).toBe('2026-07-29T06:00:00.000Z')
  })

  it('applies the DST offset effective on each occurrence date', () => {
    expect(
      occurrenceDateToUtcRunAt('2026-03-07', 'America/New_York').toISOString(),
    ).toBe('2026-03-07T20:00:00.000Z')
    expect(
      occurrenceDateToUtcRunAt('2026-03-09', 'America/New_York').toISOString(),
    ).toBe('2026-03-09T19:00:00.000Z')
  })

  it('supports zones with non-hour offsets', () => {
    expect(
      occurrenceDateToUtcRunAt('2026-07-29', 'Pacific/Chatham').toISOString(),
    ).toBe('2026-07-29T02:15:00.000Z')
  })

  it('rejects invalid dates and timezones', () => {
    expect(() => occurrenceDateToUtcRunAt('2026-02-30', 'UTC')).toThrow(
      RangeError,
    )
    expect(() =>
      occurrenceDateToUtcRunAt('2026-07-29', 'Mars/Olympus'),
    ).toThrow()
  })
})

describe('dateOnlyInTimeZone', () => {
  it('returns the local calendar date as UTC midnight', () => {
    const instant = new Date('2026-07-29T01:00:00.000Z')
    expect(
      dateOnlyInTimeZone(instant, 'America/Los_Angeles').toISOString(),
    ).toBe('2026-07-28T00:00:00.000Z')
    expect(dateOnlyInTimeZone(instant, 'Asia/Tokyo').toISOString()).toBe(
      '2026-07-29T00:00:00.000Z',
    )
  })

  it('rejects invalid instants and timezones', () => {
    expect(() => dateOnlyInTimeZone(new Date('invalid'), 'UTC')).toThrow(
      RangeError,
    )
    expect(() => dateOnlyInTimeZone(new Date(), 'Mars/Olympus')).toThrow()
  })
})
