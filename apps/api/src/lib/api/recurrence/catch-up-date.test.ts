import { describe, expect, it } from 'vitest'

import { catchUpDueThrough } from './catch-up-date'

describe('catchUpDueThrough', () => {
  it('returns the positive-offset account day for initial recurring expense creation', () => {
    expect(
      catchUpDueThrough(new Date('2026-01-01T23:30:00.000Z'), 'Asia/Tokyo'),
    ).toBe('2026-01-02')
  })

  it('returns the negative-offset account day for initial recurring expense creation', () => {
    expect(
      catchUpDueThrough(
        new Date('2026-01-02T00:30:00.000Z'),
        'America/Los_Angeles',
      ),
    ).toBe('2026-01-01')
  })
})
