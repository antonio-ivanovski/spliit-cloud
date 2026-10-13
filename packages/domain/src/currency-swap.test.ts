import { describe, expect, it } from 'vitest'

import {
  computeSwapPairs,
  computeSwapRateKeys,
  legacyModeToPairModes,
  planSwapRows,
  swapPairBaseForExpense,
} from './currency-swap'

describe('computeSwapPairs', () => {
  it('returns empty for same currency', () => {
    expect(
      computeSwapPairs(
        [{ id: 'a', expenseDate: '2024-05-01', amount: 100 }],
        'EUR',
        'EUR',
      ),
    ).toEqual([])
  })

  it('groups simple rows into O|N and EXCHANGE rows into C|N', () => {
    const pairs = computeSwapPairs(
      [
        { id: 'a', expenseDate: '2024-05-01', amount: 100 },
        {
          id: 'b',
          expenseDate: '2024-05-02',
          amount: 100,
          originalAmount: 110,
          originalCurrency: 'USD',
          conversionRate: 0.9,
          conversionSource: 'EXCHANGE',
        },
        {
          id: 'c',
          expenseDate: '2024-05-03',
          amount: 100,
          originalAmount: 85,
          originalCurrency: 'GBP',
          conversionRate: 1.17,
          conversionSource: 'EXCHANGE',
        },
      ],
      'EUR',
      'GBP',
    )
    // GBP originals clear (no pair); USD needs a pair; EUR simple needs O|N.
    expect(pairs).toEqual([
      { base: 'EUR', target: 'GBP', dates: ['2024-05-01'], expenseCount: 1 },
      { base: 'USD', target: 'GBP', dates: ['2024-05-02'], expenseCount: 1 },
    ])
  })
})

describe('computeSwapRateKeys', () => {
  it('dedupes per-date O->N keys with default (all perDate) modes', () => {
    const keys = computeSwapRateKeys(
      [
        { id: 'a', expenseDate: '2024-05-01T12:00:00Z', amount: 100 },
        { id: 'b', expenseDate: '2024-05-01T15:00:00Z', amount: 200 },
      ],
      'EUR',
      'GBP',
      {},
    )
    expect(keys).toEqual([{ date: '2024-05-01', base: 'EUR', target: 'GBP' }])
  })

  it('skips C==N and emits C->N keys for EXCHANGE rows', () => {
    const keys = computeSwapRateKeys(
      [
        {
          id: 'a',
          expenseDate: '2024-05-01',
          amount: 100,
          originalAmount: 85,
          originalCurrency: 'GBP',
          conversionRate: 1.17,
          conversionSource: 'EXCHANGE',
        },
        {
          id: 'b',
          expenseDate: '2024-05-02',
          amount: 100,
          originalAmount: 110,
          originalCurrency: 'USD',
          conversionRate: 0.9,
          conversionSource: 'EXCHANGE',
        },
      ],
      'EUR',
      'GBP',
      {},
    )
    expect(keys).toEqual([{ date: '2024-05-02', base: 'USD', target: 'GBP' }])
  })

  it('fixed pair with override needs no provider keys', () => {
    expect(
      computeSwapRateKeys(
        [{ id: 'a', expenseDate: '2024-05-01', amount: 100 }],
        'EUR',
        'GBP',
        { 'EUR|GBP': { mode: 'fixed', date: '2024-06-01', override: 0.85 } },
      ),
    ).toEqual([])
  })

  it('fixed pair without override fetches the single chosen-date key', () => {
    expect(
      computeSwapRateKeys(
        [
          { id: 'a', expenseDate: '2024-05-01', amount: 100 },
          { id: 'b', expenseDate: '2024-05-03', amount: 200 },
        ],
        'EUR',
        'GBP',
        { 'EUR|GBP': { mode: 'fixed', date: '2024-06-01' } },
      ),
    ).toEqual([{ date: '2024-06-01', base: 'EUR', target: 'GBP' }])
  })

  it('strict perDate pairs flag keys without changing market keys', () => {
    const keys = computeSwapRateKeys(
      [
        { id: 'a', expenseDate: '2026-06-01', amount: 100 },
        { id: 'b', expenseDate: '2026-06-02', amount: 200 },
      ],
      'BGN',
      'EUR',
      { 'BGN|EUR': { mode: 'perDate', allowFixedFallback: false } },
    )
    expect(keys).toEqual([
      {
        date: '2026-06-01',
        base: 'BGN',
        target: 'EUR',
        allowFixedFallback: false,
      },
      {
        date: '2026-06-02',
        base: 'BGN',
        target: 'EUR',
        allowFixedFallback: false,
      },
    ])
  })

  it('perDate pairs without the flag keep the historical key shape', () => {
    const keys = computeSwapRateKeys(
      [{ id: 'a', expenseDate: '2026-06-01', amount: 100 }],
      'BGN',
      'EUR',
      { 'BGN|EUR': { mode: 'perDate' } },
    )
    expect(keys).toEqual([{ date: '2026-06-01', base: 'BGN', target: 'EUR' }])
  })
})

describe('planSwapRows', () => {
  it('converts simple expenses via per-date O->N rate', () => {
    const [row] = planSwapRows(
      [{ id: 'a', expenseDate: '2024-05-01', amount: 10000 }],
      'EUR',
      'GBP',
      {},
      { '2024-05-01|EUR|GBP': 0.85 },
    )
    expect(row.kind).toBe('simple')
    expect(row.newAmount).toBe(8500)
    expect(row.rateDate).toBe('2024-05-01')
    expect(row.newConversionSource).toBeNull()
  })

  it('applies a fixed override to every date and stamps the chosen date', () => {
    const rows = planSwapRows(
      [
        { id: 'a', expenseDate: '2024-05-01', amount: 10000 },
        { id: 'b', expenseDate: '2024-05-03', amount: 10000 },
      ],
      'EUR',
      'GBP',
      { 'EUR|GBP': { mode: 'fixed', date: '2024-06-01', override: 0.85 } },
      {},
    )
    expect(rows.map((r) => r.newAmount)).toEqual([8500, 8500])
    expect(rows.map((r) => r.rateDate)).toEqual(['2024-06-01', '2024-06-01'])
  })

  it('clears conversion when original equals target', () => {
    const [row] = planSwapRows(
      [
        {
          id: 'a',
          expenseDate: '2024-05-01',
          amount: 11700,
          originalAmount: 10000,
          originalCurrency: 'GBP',
          conversionRate: 1.17,
          conversionSource: 'EXCHANGE',
        },
      ],
      'EUR',
      'GBP',
      {},
      {},
    )
    expect(row.kind).toBe('cleared')
    expect(row.newAmount).toBe(10000)
    expect(row.newConversionSource).toBeNull()
  })

  it('bridges CUSTOM with the O|N pair rate (r_old * bridge)', () => {
    const [row] = planSwapRows(
      [
        {
          id: 'a',
          expenseDate: '2024-05-01',
          amount: 10000,
          originalAmount: 12000,
          originalCurrency: 'USD',
          conversionRate: 0.9,
          conversionSource: 'CUSTOM',
        },
      ],
      'EUR',
      'GBP',
      { 'EUR|GBP': { mode: 'fixed', date: '2024-06-01', override: 0.85 } },
      {},
    )
    expect(row.kind).toBe('bridged')
    // 0.9 * 0.85 = 0.765; 12000 * 0.765 = 9180
    expect(row.newAmount).toBe(9180)
    expect(row.rateDate).toBe('2024-06-01')
  })

  it('marks missing rates', () => {
    const [row] = planSwapRows(
      [{ id: 'a', expenseDate: '2024-05-01', amount: 100 }],
      'EUR',
      'GBP',
      {},
      {},
    )
    expect(row.warning).toBe('missing-rate')
  })

  it('flags fallback-converted per-date rows without blocking data', () => {
    const expenses = [
      { id: 'a', expenseDate: '2026-06-01', amount: 10000 },
      { id: 'b', expenseDate: '2026-06-02', amount: 10000 },
    ]
    const rates = {
      '2026-06-01|BGN|EUR': 1 / 1.95583,
      '2026-06-02|BGN|EUR': 1 / 1.95583,
    }
    const rows = planSwapRows(expenses, 'BGN', 'EUR', {}, rates, new Set())
    expect(rows.map((r) => r.warning)).toEqual([undefined, undefined])

    const flagged = planSwapRows(
      expenses,
      'BGN',
      'EUR',
      {},
      rates,
      new Set(['2026-06-01|BGN|EUR']),
    )
    expect(flagged.map((r) => r.warning)).toEqual(['fixed-fallback', undefined])
    // The conversion itself is unaffected — only the warning is added.
    expect(flagged[0].newAmount).toBe(rows[0].newAmount)
    expect(flagged[0].rateUsed).toBe(rows[0].rateUsed)
  })

  it('flags fallback-converted fresh and bridged rows at their own pair keys', () => {
    const rows = planSwapRows(
      [
        {
          id: 'a',
          expenseDate: '2026-06-01',
          amount: 10000,
          originalAmount: 20000,
          originalCurrency: 'BGN',
          conversionRate: 0.5,
          conversionSource: 'EXCHANGE',
        },
        {
          id: 'b',
          expenseDate: '2026-06-01',
          amount: 10000,
          originalAmount: 20000,
          originalCurrency: 'USD',
          conversionRate: 0.9,
          conversionSource: 'CUSTOM',
        },
      ],
      'MKD',
      'EUR',
      {},
      {
        '2026-06-01|BGN|EUR': 1 / 1.95583,
        '2026-06-01|MKD|EUR': 0.016,
      },
      new Set(['2026-06-01|BGN|EUR', '2026-06-01|MKD|EUR']),
    )
    expect(rows.map((r) => [r.kind, r.warning])).toEqual([
      ['fresh', 'fixed-fallback'],
      ['bridged', 'fixed-fallback'],
    ])
  })

  it('legacy custom mode maps to fixed overrides per pair', () => {
    const expenses = [{ id: 'a', expenseDate: '2024-05-01', amount: 10000 }]
    const modes = legacyModeToPairModes(
      { type: 'custom', rate: 0.85 },
      'EUR',
      'GBP',
      expenses,
    )
    expect(modes).toEqual({
      'EUR|GBP': { mode: 'fixed', date: '2024-05-01', override: 0.85 },
    })
    const [row] = planSwapRows(expenses, 'EUR', 'GBP', modes, {})
    expect(row.newAmount).toBe(8500)
  })
})

describe('swapPairBaseForExpense', () => {
  it('routes simple rows to the ledger currency', () => {
    expect(swapPairBaseForExpense({}, 'EUR', 'GBP')).toBe('EUR')
  })

  it('returns null for cleared rows, which belong to no pair', () => {
    expect(
      swapPairBaseForExpense(
        { originalCurrency: 'GBP', conversionSource: 'EXCHANGE' },
        'EUR',
        'GBP',
      ),
    ).toBeNull()
  })

  it('routes EXCHANGE rows to their original currency', () => {
    expect(
      swapPairBaseForExpense(
        { originalCurrency: 'USD', conversionSource: 'EXCHANGE' },
        'EUR',
        'GBP',
      ),
    ).toBe('USD')
  })

  it('routes custom conversions back through the ledger currency', () => {
    expect(
      swapPairBaseForExpense(
        { originalCurrency: 'USD', conversionSource: 'CUSTOM' },
        'EUR',
        'GBP',
      ),
    ).toBe('EUR')
  })

  it('upper-cases the base', () => {
    expect(swapPairBaseForExpense({}, 'eur', 'gbp')).toBe('EUR')
  })
})
