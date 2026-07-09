import {
  COMMON_CURRENCY_HALF_LIFE_DAYS,
  COMMON_CURRENCY_LIMIT,
  commonCurrencyLookbackDate,
  currencyRecencyAgeDays,
  currencyRecencyWeight,
  effectiveExpenseCurrency,
  isSupportedCurrencyCode,
  rankCommonCurrencies,
  type ExpenseCurrencyHistoryRow,
} from './common-currencies'

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

describe('effectiveExpenseCurrency', () => {
  it('uses originalCurrency when present', () => {
    expect(effectiveExpenseCurrency('EUR', 'USD')).toBe('EUR')
  })

  it('falls back to group currency when original is null', () => {
    expect(effectiveExpenseCurrency(null, 'USD')).toBe('USD')
  })

  it('returns null when neither is set', () => {
    expect(effectiveExpenseCurrency(null, null)).toBeNull()
    expect(effectiveExpenseCurrency(undefined, undefined)).toBeNull()
  })
})

describe('isSupportedCurrencyCode', () => {
  it('accepts known ISO codes', () => {
    expect(isSupportedCurrencyCode('USD')).toBe(true)
    expect(isSupportedCurrencyCode('EUR')).toBe(true)
  })

  it('rejects unsupported / custom values', () => {
    expect(isSupportedCurrencyCode('XXX')).toBe(false)
    expect(isSupportedCurrencyCode('bitcoin')).toBe(false)
    expect(isSupportedCurrencyCode('')).toBe(false)
  })
})

describe('currencyRecencyAgeDays', () => {
  const today = d('2026-07-09')

  it('counts whole UTC days between expense and today', () => {
    expect(currencyRecencyAgeDays(d('2026-07-09'), today)).toBe(0)
    expect(currencyRecencyAgeDays(d('2026-07-08'), today)).toBe(1)
    expect(currencyRecencyAgeDays(d('2026-04-10'), today)).toBe(90)
  })

  it('clamps future dates to age 0', () => {
    expect(currencyRecencyAgeDays(d('2026-12-01'), today)).toBe(0)
  })
})

describe('currencyRecencyWeight', () => {
  it('is 1 for age 0', () => {
    expect(currencyRecencyWeight(0)).toBe(1)
  })

  it('halves every half-life window', () => {
    expect(currencyRecencyWeight(COMMON_CURRENCY_HALF_LIFE_DAYS)).toBeCloseTo(
      0.5,
      10,
    )
    expect(
      currencyRecencyWeight(COMMON_CURRENCY_HALF_LIFE_DAYS * 2),
    ).toBeCloseTo(0.25, 10)
  })
})

describe('rankCommonCurrencies', () => {
  const today = d('2026-07-09')

  function rank(
    rows: ExpenseCurrencyHistoryRow[],
    groupCurrency: string | null = 'USD',
  ) {
    return rankCommonCurrencies(rows, { groupCurrency, today })
  }

  it('returns empty when history is empty', () => {
    expect(rank([])).toEqual([])
  })

  it('excludes the pinned group currency from ranked results', () => {
    expect(
      rank([
        { originalCurrency: null, expenseDate: d('2026-07-01') },
        { originalCurrency: 'USD', expenseDate: d('2026-07-02') },
        { originalCurrency: 'EUR', expenseDate: d('2026-07-03') },
      ]),
    ).toEqual(['EUR'])
  })

  it('treats null originalCurrency as group currency (same-currency expense)', () => {
    // Only group-currency history → nothing recommended.
    expect(
      rank([{ originalCurrency: null, expenseDate: d('2026-07-01') }]),
    ).toEqual([])
  })

  it('ranks by recency-weighted score (recent beats many old)', () => {
    const rows: ExpenseCurrencyHistoryRow[] = [
      // Many old EUR expenses (~180 days → weight 0.25 each)
      ...Array.from({ length: 4 }, () => ({
        originalCurrency: 'EUR',
        expenseDate: d('2026-01-10'),
      })),
      // One recent GBP (age 0 → weight 1)
      { originalCurrency: 'GBP', expenseDate: d('2026-07-09') },
    ]
    // EUR total score ≈ 1.0, GBP = 1.0 — count/latest/code break ties after score.
    // With equal scores, EUR has higher count → EUR first.
    // Adjust: make GBP clearly win with two recent.
    rows.push({ originalCurrency: 'GBP', expenseDate: d('2026-07-08') })
    expect(rank(rows)[0]).toBe('GBP')
  })

  it('uses 90-day half-life decay', () => {
    // One EUR at age 0 (score 1) vs two GBP at age 90 (score 0.5 each = 1 total).
    // Equal score → GBP wins on count.
    expect(
      rank([
        { originalCurrency: 'EUR', expenseDate: d('2026-07-09') },
        { originalCurrency: 'GBP', expenseDate: d('2026-04-10') },
        { originalCurrency: 'GBP', expenseDate: d('2026-04-10') },
      ]),
    ).toEqual(['GBP', 'EUR'])
  })

  it('breaks equal scores by raw count', () => {
    expect(
      rank([
        { originalCurrency: 'EUR', expenseDate: d('2026-07-09') },
        { originalCurrency: 'GBP', expenseDate: d('2026-07-09') },
        { originalCurrency: 'GBP', expenseDate: d('2026-07-09') },
      ]),
    ).toEqual(['GBP', 'EUR'])
  })

  it('breaks equal score+count by most recent expense date', () => {
    expect(
      rank([
        { originalCurrency: 'EUR', expenseDate: d('2026-07-01') },
        { originalCurrency: 'GBP', expenseDate: d('2026-07-05') },
      ]),
    ).toEqual(['GBP', 'EUR'])
  })

  it('breaks remaining ties by currency code ascending', () => {
    expect(
      rank([
        { originalCurrency: 'JPY', expenseDate: d('2026-07-09') },
        { originalCurrency: 'EUR', expenseDate: d('2026-07-09') },
      ]),
    ).toEqual(['EUR', 'JPY'])
  })

  it('limits results to five currencies', () => {
    const codes = ['EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'SEK']
    const rows = codes.map((code) => ({
      originalCurrency: code,
      expenseDate: d('2026-07-09'),
    }))
    const result = rank(rows)
    expect(result).toHaveLength(COMMON_CURRENCY_LIMIT)
    // Alphabetical among equal scores/counts/dates: AUD, CAD, CHF, EUR, GBP
    expect(result).toEqual(['AUD', 'CAD', 'CHF', 'EUR', 'GBP'])
  })

  it('ignores unsupported / custom historical currency values', () => {
    expect(
      rank([
        { originalCurrency: 'XXX', expenseDate: d('2026-07-09') },
        { originalCurrency: 'bitcoin', expenseDate: d('2026-07-09') },
        { originalCurrency: 'EUR', expenseDate: d('2026-07-09') },
      ]),
    ).toEqual(['EUR'])
  })

  it('handles custom group currency (null group code)', () => {
    // No group pin; null originalCurrency cannot resolve → skipped.
    expect(
      rank(
        [
          { originalCurrency: null, expenseDate: d('2026-07-09') },
          { originalCurrency: 'EUR', expenseDate: d('2026-07-09') },
        ],
        null,
      ),
    ).toEqual(['EUR'])
  })

  it('clamps future expense dates when scoring', () => {
    // Future EUR and today GBP: both age 0, equal score → code order EUR, GBP.
    expect(
      rank([
        { originalCurrency: 'EUR', expenseDate: d('2026-12-01') },
        { originalCurrency: 'GBP', expenseDate: d('2026-07-09') },
      ]),
    ).toEqual(['EUR', 'GBP'])
  })
})

describe('commonCurrencyLookbackDate', () => {
  it('returns a date lookbackDays before today (UTC)', () => {
    expect(commonCurrencyLookbackDate(d('2026-07-09'), 730).toISOString()).toBe(
      '2024-07-09T00:00:00.000Z',
    )
  })
})
