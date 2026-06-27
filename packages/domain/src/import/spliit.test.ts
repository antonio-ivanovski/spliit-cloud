import { describe, expect, it } from 'vitest'
import {
  buildSpliitGroupFetchUrl,
  extractSpliitGroupIdFromUrl,
  parseSpliitExport,
  tryParseSpliitExport,
} from './spliit'

const validExport = {
  id: 'grp-123',
  name: 'Sardinia 2025/6',
  currency: '€',
  currencyCode: 'EUR',
  participants: [
    { id: 'p-1', name: 'Antonio' },
    { id: 'p-2', name: 'Bela' },
  ],
  expenses: [
    {
      createdAt: '2025-11-15T00:00:00.000Z',
      expenseDate: '2025-11-15T00:00:00.000Z',
      title: 'Dures Bari',
      category: { grouping: 'Transportation', name: 'Transportation' },
      amount: 23000,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      paidById: 'p-1',
      paidFor: [
        { participantId: 'p-1', shares: 300 },
        { participantId: 'p-2', shares: 200 },
      ],
      isReimbursement: false,
      splitMode: 'EVENLY',
      recurrenceRule: 'NONE',
    },
    {
      createdAt: '2025-11-17T00:00:00.000Z',
      expenseDate: '2025-11-17T00:00:00.000Z',
      title: 'Suplementi i lekovi',
      category: { grouping: 'Life', name: 'Medical Expenses' },
      amount: 11500,
      paidById: 'p-2',
      paidFor: [
        { participantId: 'p-1', shares: 3000 },
        { participantId: 'p-2', shares: 7000 },
      ],
      isReimbursement: false,
      splitMode: 'BY_PERCENTAGE',
      recurrenceRule: 'NONE',
    },
  ],
}

describe('parseSpliitExport', () => {
  it('parses a representative export into the normalized shape', () => {
    const result = parseSpliitExport(validExport)
    expect(result.sourceGroupId).toBe('grp-123')
    expect(result.sourceUrl).toBe('https://spliit.app/groups/grp-123')
    expect(result.name).toBe('Sardinia 2025/6')
    expect(result.currency).toBe('€')
    expect(result.currencyCode).toBe('EUR')
    expect(result.participants).toEqual([
      { sourceId: 'spliit-participant-0', sourceName: 'Antonio' },
      { sourceId: 'spliit-participant-1', sourceName: 'Bela' },
    ])
    expect(result.expenses).toHaveLength(2)
    const [first, second] = result.expenses
    expect(first.title).toBe('Dures Bari')
    expect(first.category).toBe('transportation')
    expect(first.amount).toBe(23000)
    expect(first.paidBySourceId).toBe('spliit-participant-0')
    expect(first.splitMode).toBe('EVENLY')
    expect(first.paidFor).toEqual([
      { sourceId: 'spliit-participant-0', shares: 300 },
      { sourceId: 'spliit-participant-1', shares: 200 },
    ])
    expect(second.splitMode).toBe('BY_PERCENTAGE')
    expect(second.paidFor).toEqual([
      { sourceId: 'spliit-participant-0', shares: 3000 },
      { sourceId: 'spliit-participant-1', shares: 7000 },
    ])
  })

  it('mints parser-local source ids instead of trusting upstream ids', () => {
    const result = parseSpliitExport({
      ...validExport,
      participants: [
        { id: 'some-low-entropy-id', name: 'A' },
        { id: 'with spaces and 🎉', name: 'B' },
        { id: 'with.dots/and-slashes', name: 'C' },
      ],
      expenses: [
        {
          ...validExport.expenses[0],
          paidById: 'some-low-entropy-id',
          paidFor: [
            { participantId: 'with spaces and 🎉', shares: 100 },
            { participantId: 'with.dots/and-slashes', shares: 200 },
          ],
        },
      ],
    })
    expect(result.participants.map((p) => p.sourceId)).toEqual([
      'spliit-participant-0',
      'spliit-participant-1',
      'spliit-participant-2',
    ])
    expect(JSON.stringify(result)).not.toContain('some-low-entropy-id')
    expect(JSON.stringify(result)).not.toContain('with spaces')
    expect(JSON.stringify(result)).not.toContain('with.dots')
  })

  it('rewrites paidById through the participant map', () => {
    const result = parseSpliitExport({
      ...validExport,
      participants: [
        { id: 'AAA', name: 'A' },
        { id: 'BBB', name: 'B' },
      ],
      expenses: [
        {
          ...validExport.expenses[0],
          paidById: 'BBB',
          paidFor: [
            { participantId: 'AAA', shares: 100 },
            { participantId: 'BBB', shares: 200 },
          ],
        },
      ],
    })
    expect(result.expenses[0].paidBySourceId).toBe('spliit-participant-1')
  })

  it('rewrites paidFor[].participantId through the participant map', () => {
    const result = parseSpliitExport({
      ...validExport,
      participants: [
        { id: 'AAA', name: 'A' },
        { id: 'BBB', name: 'B' },
        { id: 'CCC', name: 'C' },
      ],
      expenses: [
        {
          ...validExport.expenses[0],
          paidById: 'AAA',
          paidFor: [
            { participantId: 'BBB', shares: 100 },
            { participantId: 'CCC', shares: 200 },
          ],
        },
      ],
    })
    expect(result.expenses[0].paidFor.map((p) => p.sourceId)).toEqual([
      'spliit-participant-1',
      'spliit-participant-2',
    ])
  })

  it('falls back to "general" for an unrecognized category', () => {
    const result = parseSpliitExport({
      ...validExport,
      expenses: [
        {
          ...validExport.expenses[0],
          category: { grouping: 'Whatever', name: 'Mystery' },
        },
      ],
    })
    expect(result.expenses[0].category).toBe('general')
  })

  it('preserves original currency and conversion fields', () => {
    const result = parseSpliitExport({
      ...validExport,
      expenses: [
        {
          ...validExport.expenses[0],
          originalAmount: 10000,
          originalCurrency: 'USD',
          conversionRate: 1.1,
        },
      ],
    })
    expect(result.expenses[0].originalAmount).toBe(10000)
    expect(result.expenses[0].originalCurrency).toBe('USD')
    expect(result.expenses[0].conversionRate).toBe(1.1)
  })

  it('accepts a minimal valid export with no optional fields', () => {
    const result = parseSpliitExport({
      id: 'g1',
      name: 'X',
      currency: '$',
      participants: [{ id: 'p1', name: 'P' }],
      expenses: [],
    })
    expect(result.expenses).toEqual([])
    expect(result.currencyCode).toBeNull()
    expect(result.sourceUrl).toBe('https://spliit.app/groups/g1')
  })

  it('rejects duplicate upstream participant ids', () => {
    const result = tryParseSpliitExport({
      ...validExport,
      participants: [
        { id: 'dup', name: 'A' },
        { id: 'dup', name: 'B' },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/duplicate participant ids/i)
  })

  it('rejects an expense that references an unknown paidById', () => {
    const result = tryParseSpliitExport({
      ...validExport,
      expenses: [
        {
          ...validExport.expenses[0],
          paidById: 'unknown-upstream-id',
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(
      /Expense "Dures Bari" references an unknown participant\./,
    )
  })

  it('rejects an expense that references an unknown paidFor participantId', () => {
    const result = tryParseSpliitExport({
      ...validExport,
      expenses: [
        {
          ...validExport.expenses[0],
          paidFor: [
            { participantId: 'p-1', shares: 100 },
            { participantId: 'unknown-upstream-id', shares: 100 },
          ],
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(
      /Expense "Dures Bari" references an unknown participant\./,
    )
  })

  it('rejects an expense with duplicate paid-for participants', () => {
    const result = tryParseSpliitExport({
      ...validExport,
      expenses: [
        {
          ...validExport.expenses[0],
          paidFor: [
            { participantId: 'p-1', shares: 100 },
            { participantId: 'p-1', shares: 200 },
          ],
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/duplicate paid-for participants/i)
  })

  it('returns a clean error for a malformed export', () => {
    const result = tryParseSpliitExport({ id: 'no' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe(
      'This file is not a supported spliit.app JSON export.',
    )
  })

  it('rejects an expense with a non-positive share', () => {
    const result = tryParseSpliitExport({
      ...validExport,
      expenses: [
        {
          ...validExport.expenses[0],
          paidFor: [
            { participantId: 'p-1', shares: 0 },
            { participantId: 'p-2', shares: 200 },
          ],
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/non-positive share/i)
  })
})

describe('buildSpliitGroupFetchUrl', () => {
  it('builds the canonical spliit.app export URL', () => {
    expect(buildSpliitGroupFetchUrl('grp-1')).toBe(
      'https://spliit.app/groups/grp-1/expenses/export/json',
    )
  })

  it('strips leading and trailing slashes from the id', () => {
    expect(buildSpliitGroupFetchUrl('/grp-1/')).toBe(
      'https://spliit.app/groups/grp-1/expenses/export/json',
    )
  })
})

describe('extractSpliitGroupIdFromUrl', () => {
  it('returns the id from a canonical spliit.app URL', () => {
    expect(extractSpliitGroupIdFromUrl('https://spliit.app/groups/abc')).toBe(
      'abc',
    )
  })
  it('returns the id from a www-prefixed spliit.app URL', () => {
    expect(
      extractSpliitGroupIdFromUrl('https://www.spliit.app/groups/abc'),
    ).toBe('abc')
  })
  it('returns null for a different host', () => {
    expect(extractSpliitGroupIdFromUrl('https://example.com/groups/abc')).toBe(
      null,
    )
  })
  it('returns null when the path is not /groups/<id>', () => {
    expect(extractSpliitGroupIdFromUrl('https://spliit.app/foo')).toBe(null)
  })
  it('returns null for unparseable URLs', () => {
    expect(extractSpliitGroupIdFromUrl('not a url')).toBe(null)
  })
})
