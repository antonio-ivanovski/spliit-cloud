import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatExpenseClosed } from './expense-display'

describe('formatExpenseClosed', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('omits tzHint when the expense zone matches the reference zone', () => {
    const result = formatExpenseClosed(
      {
        expenseDate: new Date('2026-08-12T12:30:00.000Z'),
        expenseTimeZone: 'UTC',
      },
      'en-US',
      'UTC',
    )

    expect(result.tzHint).toBeUndefined()
    expect(result.text).toBe(`${result.date} ${result.time}`)
    expect(result.text).not.toMatch(/GMT/)
    expect(result.tooltip).toBeUndefined()
  })

  it('uses a city-only tzHint and keeps offset plus your-time in the tooltip', () => {
    const result = formatExpenseClosed(
      {
        expenseDate: new Date('2026-08-12T19:30:00.000Z'),
        expenseTimeZone: 'America/Los_Angeles',
      },
      'en-US',
      'UTC',
      'your time',
    )

    expect(result.tzHint).toBe('Los Angeles')
    expect(result.text).toBe(`${result.date} ${result.time} · Los Angeles`)
    expect(result.text).not.toMatch(/GMT/)
    expect(result.tooltip).toMatch(
      /^12:30 Los Angeles · GMT-07:00 · your time /,
    )
    expect(result.tooltip).toContain('your time 19:30')
  })

  it('omits the year from shortDate in the current year and includes it otherwise', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T12:00:00.000Z'))

    const currentYear = formatExpenseClosed(
      {
        expenseDate: new Date('2026-03-04T15:00:00.000Z'),
        expenseTimeZone: 'UTC',
      },
      'en-US',
      'UTC',
    )
    const previousYear = formatExpenseClosed(
      {
        expenseDate: new Date('2025-06-15T00:00:00.000Z'),
        expenseTimeZone: 'UTC',
      },
      'en-US',
      'UTC',
    )

    expect(currentYear.shortDate).toBe('Mar 4')
    expect(currentYear.shortDate).not.toMatch(/2026/)
    expect(previousYear.shortDate).toBe('Jun 15, 2025')
  })
})
