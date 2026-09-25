import { describe, expect, it } from 'vitest'

import {
  formatNotificationAmount,
  formatNotificationDate,
  formatNotificationNumber,
  formatNotificationPercent,
} from './format'
import {
  formatExpenseAmount,
  formatExpenseDualAmount,
  resolveGroupDisplayName,
} from './expense-notification-shared'

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

describe('formatExpenseAmount', () => {
  it('renders EUR with two decimal places', () => {
    expect(formatExpenseAmount(4500, 'EUR')).toBe('EUR 45.00')
  })

  it('renders JPY with zero decimal places', () => {
    expect(formatExpenseAmount(1000, 'JPY')).toBe('JPY 1000')
  })

  it('omits the currency prefix when no code is provided', () => {
    expect(formatExpenseAmount(4500)).toBe('45.00')
  })
})

describe('formatExpenseDualAmount', () => {
  it('renders both currencies when they differ', () => {
    expect(formatExpenseDualAmount(670, 'JPY', 5000, 'EUR')).toBe(
      'JPY 5000 (EUR 6.70)',
    )
  })

  it('renders a single amount when currencies are identical', () => {
    expect(formatExpenseDualAmount(4500, 'EUR', 4500, 'EUR')).toBe('EUR 45.00')
  })

  it('falls back to ledgerCurrencyCode when currencyCode is null', () => {
    expect(formatExpenseDualAmount(4500, null, undefined, 'EUR')).toBe(
      'EUR 45.00',
    )
  })

  it('does not show dual-currency when currencyCode is null even if originalAmount differs', () => {
    expect(formatExpenseDualAmount(670, null, 500000, 'EUR')).toBe('EUR 6.70')
  })
})

describe('resolveGroupDisplayName', () => {
  const members = [
    { account: { id: 'acct-alice', name: 'Alice', email: 'a@test' } },
    { account: { id: 'acct-bob', name: 'Bob', email: 'b@test' } },
  ]

  it('returns the group name unchanged for non-FRIEND groups', () => {
    expect(
      resolveGroupDisplayName(
        'GROUP',
        'Trip',
        members,
        'acct-alice',
        undefined,
      ),
    ).toBe('Trip')
  })

  it('uses the peer name from a recipient perspective', () => {
    expect(
      resolveGroupDisplayName('FRIEND', 'abc', members, 'acct-bob', undefined),
    ).toBe('your friend ledger with Alice')
  })

  it('falls back to the pending temporary name when no recipient is provided', () => {
    expect(
      resolveGroupDisplayName('FRIEND', 'abc', [], undefined, 'Charlie'),
    ).toBe('your friend ledger with Charlie')
  })

  it('returns the bare fallback when nothing else applies', () => {
    expect(
      resolveGroupDisplayName('FRIEND', 'abc', [], 'acct-x', undefined),
    ).toBe('your friend ledger')
  })
})
