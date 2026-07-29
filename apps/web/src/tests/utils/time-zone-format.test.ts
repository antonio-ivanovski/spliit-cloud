import { describe, expect, it } from 'vitest'

import { formatZonedDate } from '@/lib/utils'

describe('formatZonedDate', () => {
  it('formats the same instant in the selected account or group timezone', () => {
    const instant = new Date('2026-01-01T00:30:00.000Z')
    expect(
      formatZonedDate(instant, 'en-US', 'America/Los_Angeles', {
        dateStyle: 'short',
      }),
    ).toBe('12/31/25')
    expect(
      formatZonedDate(instant, 'en-US', 'Europe/Skopje', {
        dateStyle: 'short',
      }),
    ).toBe('1/1/26')
  })
})
