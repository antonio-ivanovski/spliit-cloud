import { describe, expect, it } from 'vitest'

import {
  buildSpliitGroupFetchUrl,
  extractSpliitGroupIdFromUrl,
  parseSpliitExport,
  tryParseSpliitExport,
} from './spliit'

const validExport = {
  id: 'grp-123',
  name: 'Spliit Export Group',
  currency: '€',
  currencyCode: 'EUR',
  participants: [
    { id: 'p-1', name: 'John' },
    { id: 'p-2', name: 'Jane' },
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
  it('maps legacy recurrence rules to an interval-one indefinite config', () => {
    const result = parseSpliitExport({
      ...validExport,
      expenses: [
        {
          ...validExport.expenses[0],
          recurrenceRule: 'MONTHLY',
        },
      ],
    })
    expect(result.expenses[0].recurrence).toEqual({
      frequency: 'MONTHLY',
      interval: 1,
      end: { type: 'INDEFINITE' },
    })
    expect(result.expenses[0].recurrenceRule).toBe('MONTHLY')
  })

  it('ignores Spliit Cloud recurrence state outside the legacy schema', () => {
    const result = parseSpliitExport({
      ...validExport,
      expenses: [
        {
          ...validExport.expenses[0],
          recurrence: {
            seriesId: 'series-1',
            frequency: 'YEARLY',
            interval: 2,
            end: {
              type: 'DATE',
              endDate: '2030-02-28',
            },
            status: 'CANCELLED',
            anchorDate: '2026-02-28',
            anchorSequence: 3,
            nextOccurrenceDate: '2030-02-28',
            nextOccurrenceOrdinal: 5,
            template: {
              title: 'Current template',
              categoryId: 'transportation',
              amount: 23000,
              originalAmount: null,
              originalCurrency: null,
              conversionRate: null,
              conversionSource: null,
              paidBySplitMode: 'BY_AMOUNT',
              paidByList: [{ ledgerParticipantId: 'p-1', shares: 23000 }],
              paidFor: [
                { ledgerParticipantId: 'p-1', shares: 300 },
                { ledgerParticipantId: 'p-2', shares: 200 },
              ],
              splitMode: 'EVENLY',
              isReimbursement: false,
              notes: 'future state',
              items: [],
              itemizedRemainder: null,
            },
          },
          recurrenceSequence: 3,
        },
      ],
    })
    expect(result.expenses[0].recurrence).toBeNull()
    expect('recurrenceSeriesId' in result.expenses[0]).toBe(false)
    expect('recurrenceSequence' in result.expenses[0]).toBe(false)
    expect(result.expenses[0].recurrenceRule).toBe('NONE')
  })

  it('parses a representative export into the normalized shape', () => {
    const result = parseSpliitExport(validExport)
    expect(result.sourceGroupId).toBe('grp-123')
    expect(result.sourceUrl).toBe('https://spliit.app/groups/grp-123')
    expect(result.name).toBe('Spliit Export Group')
    expect(result.currency).toBe('€')
    expect(result.currencyCode).toBe('EUR')
    expect(result.participants).toEqual([
      { sourceId: 'spliit-participant-0', sourceName: 'John' },
      { sourceId: 'spliit-participant-1', sourceName: 'Jane' },
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

  it('recovers original amount from ledger ÷ rate (ignores export originalAmount)', () => {
    const result = parseSpliitExport({
      ...validExport,
      expenses: [
        {
          ...validExport.expenses[0],
          amount: 11000,
          originalAmount: 10000,
          originalCurrency: 'USD',
          conversionRate: 1.1,
        },
      ],
    })
    // round(11000 / 1.1) = 10000
    expect(result.expenses[0].originalAmount).toBe(10000)
    expect(result.expenses[0].originalCurrency).toBe('USD')
    expect(result.expenses[0].conversionRate).toBe(1.1)
    expect(result.expenses[0].amount).toBe(10000)
    expect(result.expenses[0].amountCurrency).toBe('USD')
    expect(result.expenses[0].paidBy[0].shares).toBe(10000)
  })

  it('recovers cents when export originalAmount dropped them (upstream #513)', () => {
    // User typed 1.23 BGN; upstream stored originalAmount=1, ledger amount=123, rate=1.
    const result = parseSpliitExport({
      ...validExport,
      expenses: [
        {
          ...validExport.expenses[0],
          amount: 123,
          originalAmount: 1,
          originalCurrency: 'BGN',
          conversionRate: 1,
        },
      ],
    })
    expect(result.expenses[0].amount).toBe(123)
    expect(result.expenses[0].originalAmount).toBe(123)
    expect(result.expenses[0].amountCurrency).toBe('BGN')
    expect(result.expenses[0].originalCurrency).toBe('BGN')
    expect(result.expenses[0].paidBy[0].shares).toBe(123)
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

  it('scales BY_SHARES weights from whole shares into fixed units', () => {
    // Legacy spliit.app JSON exports BY_SHARES as whole share counts; the
    // new internal contract stores hundredths so 1 share → 100, 2 → 200.
    const result = parseSpliitExport({
      ...validExport,
      expenses: [
        {
          ...validExport.expenses[0],
          splitMode: 'BY_SHARES',
          paidFor: [
            { participantId: 'p-1', shares: 2 },
            { participantId: 'p-2', shares: 1 },
          ],
        },
      ],
    })
    expect(result.expenses[0].splitMode).toBe('BY_SHARES')
    expect(result.expenses[0].paidFor).toEqual([
      { sourceId: 'spliit-participant-0', shares: 200 },
      { sourceId: 'spliit-participant-1', shares: 100 },
    ])
  })

  it('does not touch EVENLY/PERCENTAGE/AMOUNT weights when normalising', () => {
    const result = parseSpliitExport({
      ...validExport,
      expenses: [
        {
          ...validExport.expenses[0],
          splitMode: 'EVENLY',
          paidFor: [
            { participantId: 'p-1', shares: 5000 },
            { participantId: 'p-2', shares: 5000 },
          ],
        },
        {
          ...validExport.expenses[1],
          paidFor: [
            { participantId: 'p-1', shares: 2500 },
            { participantId: 'p-2', shares: 7500 },
          ],
        },
      ],
    })
    expect(result.expenses[0].paidFor).toEqual([
      { sourceId: 'spliit-participant-0', shares: 5000 },
      { sourceId: 'spliit-participant-1', shares: 5000 },
    ])
    expect(result.expenses[1].paidFor).toEqual([
      { sourceId: 'spliit-participant-0', shares: 2500 },
      { sourceId: 'spliit-participant-1', shares: 7500 },
    ])
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
