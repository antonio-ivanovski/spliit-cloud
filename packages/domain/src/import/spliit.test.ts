import * as fs from 'fs'
import * as path from 'path'

import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import {
  buildSpliitGroupFetchUrl,
  extractSpliitGroupIdFromUrl,
  parseSpliitExport,
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
  it.effect(
    'parses export v3 information, embedded documents, and history',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSpliitExport({
          ...validExport,
          exportVersion: 3,
          information: 'Bring receipts',
          expenses: [
            {
              ...validExport.expenses[0],
              id: 'expense-1',
              notes: 'Paid at the counter',
              documents: [
                {
                  id: 'document-1',
                  url: 'https://uploads.example.com/receipt.jpg',
                  width: 1200,
                  height: 900,
                },
              ],
            },
          ],
          activities: [
            {
              id: 'activity-1',
              time: '2025-11-15T01:00:00.000Z',
              activityType: 'CREATE_EXPENSE',
              participantId: 'p-1',
              expenseId: 'expense-1',
              data: 'Dures Bari',
            },
            {
              id: 'activity-2',
              time: '2025-11-16T01:00:00.000Z',
              activityType: 'DELETE_EXPENSE',
              participantId: 'deleted-participant',
              expenseId: 'deleted-expense',
              data: 'Old receipt',
            },
          ],
        })

        expect(source.information).toBe('Bring receipts')
        expect(source.exportVersion).toBe(3)
        expect(source.documentSource).toBe('EMBEDDED')
        expect(source.expenses[0]).toMatchObject({
          sourceId: 'expense-1',
          notes: 'Paid at the counter',
          sourceDocuments: [
            {
              sourceId: 'document-1',
              sourceUrl: 'https://uploads.example.com/receipt.jpg',
              width: 1200,
              height: 900,
            },
          ],
        })
        expect(source.activities).toEqual([
          {
            time: '2025-11-15T01:00:00.000Z',
            activityType: 'CREATE_EXPENSE',
            participantSourceId: 'spliit-participant-0',
            expenseSourceId: 'expense-1',
            data: 'Dures Bari',
          },
          {
            time: '2025-11-16T01:00:00.000Z',
            activityType: 'DELETE_EXPENSE',
            participantSourceId: null,
            expenseSourceId: 'deleted-expense',
            data: 'Old receipt',
          },
        ])
      }),
  )

  it.effect('treats embedded empty document arrays as authoritative', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitExport({
        ...validExport,
        exportVersion: 3,
        expenses: validExport.expenses.map((expense) => ({
          ...expense,
          notes: null,
          documents: [],
        })),
      })
      expect(source.documentSource).toBe('EMBEDDED')
      expect(source.expenses.every((expense) => expense.sourceDocuments)).toBe(
        true,
      )
    }),
  )

  it.effect('accepts the unversioned notes-and-history export before v3', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitExport({
        ...validExport,
        information: 'Unversioned information',
        activities: [],
      })
      expect(source.information).toBe('Unversioned information')
      expect(source.exportVersion).toBeNull()
      expect(source.activities).toEqual([])
      expect(source.documentSource).toBe('DISCOVERY')
    }),
  )

  it.effect(
    'does not infer embedded document support for an unversioned export',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSpliitExport({
          ...validExport,
          expenses: validExport.expenses.map((expense) => ({
            ...expense,
            documents: [],
          })),
        })
        expect(source.exportVersion).toBeNull()
        expect(source.documentSource).toBe('DISCOVERY')
        expect(source.expenses[0].sourceDocuments).toBeUndefined()
      }),
  )

  it.effect('rejects unknown explicit export versions', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        parseSpliitExport({ ...validExport, exportVersion: 4 }),
      )
      expect(error.message).toBe(
        'This file is not a supported spliit.app JSON export.',
      )
      expect(error.code).toBe('SPLIIT_UNSUPPORTED_SHAPE')
      expect(error.params).toEqual({})
    }),
  )

  it.effect(
    'maps legacy recurrence rules to an interval-one indefinite config',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSpliitExport({
          ...validExport,
          expenses: [
            {
              ...validExport.expenses[0],
              recurrenceRule: 'MONTHLY',
            },
          ],
        })
        expect(source.expenses[0].recurrence).toEqual({
          frequency: 'MONTHLY',
          interval: 1,
          end: { type: 'INDEFINITE' },
        })
        expect(source.expenses[0].recurrenceRule).toBe('MONTHLY')
      }),
  )

  it.effect(
    'ignores Spliit Cloud recurrence state outside the legacy schema',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSpliitExport({
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
        expect(source.expenses[0].recurrence).toBeNull()
        expect('recurrenceSeriesId' in source.expenses[0]).toBe(false)
        expect('recurrenceSequence' in source.expenses[0]).toBe(false)
        expect(source.expenses[0].recurrenceRule).toBe('NONE')
      }),
  )

  it.effect('parses a representative export into the normalized shape', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitExport(validExport)
      expect(source.sourceGroupId).toBe('grp-123')
      expect(source.sourceUrl).toBe('https://spliit.app/groups/grp-123')
      expect(source.name).toBe('Spliit Export Group')
      expect(source.currency).toBe('€')
      expect(source.currencyCode).toBe('EUR')
      expect(source.participants).toEqual([
        { sourceId: 'spliit-participant-0', sourceName: 'John' },
        { sourceId: 'spliit-participant-1', sourceName: 'Jane' },
      ])
      expect(source.expenses).toHaveLength(2)
      const [first, second] = source.expenses
      expect(first.title).toBe('Dures Bari')
      expect(first.sourceCreatedAt).toBe('2025-11-15T00:00:00.000Z')
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
    }),
  )

  it.effect(
    'maps isReimbursement true onto settlement regardless of stored category',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSpliitExport({
          ...validExport,
          expenses: [
            {
              ...validExport.expenses[0],
              category: { grouping: 'Food and Drink', name: 'Dining Out' },
              isReimbursement: true,
            },
            {
              ...validExport.expenses[0],
              title: 'Bank transfer',
              category: { grouping: 'Uncategorized', name: 'Payment' },
              isReimbursement: false,
            },
          ],
        })
        expect(source.expenses[0].category).toBe('settlement')
        expect(source.expenses[1].category).toBe('payment')
      }),
  )

  it.effect(
    'mints parser-local source ids instead of trusting upstream ids',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSpliitExport({
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
        expect(source.participants.map((p) => p.sourceId)).toEqual([
          'spliit-participant-0',
          'spliit-participant-1',
          'spliit-participant-2',
        ])
        expect(JSON.stringify(source)).not.toContain('some-low-entropy-id')
        expect(JSON.stringify(source)).not.toContain('with spaces')
        expect(JSON.stringify(source)).not.toContain('with.dots')
      }),
  )

  it.effect('rewrites paidById through the participant map', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitExport({
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
      expect(source.expenses[0].paidBySourceId).toBe('spliit-participant-1')
    }),
  )

  it.effect(
    'rewrites paidFor[].participantId through the participant map',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSpliitExport({
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
        expect(source.expenses[0].paidFor.map((p) => p.sourceId)).toEqual([
          'spliit-participant-1',
          'spliit-participant-2',
        ])
      }),
  )

  it.effect('falls back to "general" for an unrecognized category', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitExport({
        ...validExport,
        expenses: [
          {
            ...validExport.expenses[0],
            category: { grouping: 'Whatever', name: 'Mystery' },
          },
        ],
      })
      expect(source.expenses[0].category).toBe('general')
    }),
  )

  it.effect(
    'recovers original amount from ledger ÷ rate (ignores export originalAmount)',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSpliitExport({
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
        expect(source.expenses[0].originalAmount).toBe(10000)
        expect(source.expenses[0].originalCurrency).toBe('USD')
        expect(source.expenses[0].conversionRate).toBe(1.1)
        expect(source.expenses[0].amount).toBe(10000)
        expect(source.expenses[0].amountCurrency).toBe('USD')
        expect(source.expenses[0].paidBy[0].shares).toBe(10000)
      }),
  )

  it.effect(
    'recovers cents when export originalAmount dropped them (upstream #513)',
    () =>
      Effect.gen(function* () {
        // User typed 1.23 BGN; upstream stored originalAmount=1, ledger amount=123, rate=1.
        const source = yield* parseSpliitExport({
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
        expect(source.expenses[0].amount).toBe(123)
        expect(source.expenses[0].originalAmount).toBe(123)
        expect(source.expenses[0].amountCurrency).toBe('BGN')
        expect(source.expenses[0].originalCurrency).toBe('BGN')
        expect(source.expenses[0].paidBy[0].shares).toBe(123)
      }),
  )

  it.effect('accepts a minimal valid export with no optional fields', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitExport({
        id: 'g1',
        name: 'X',
        currency: '$',
        participants: [{ id: 'p1', name: 'P' }],
        expenses: [],
      })
      expect(source.expenses).toEqual([])
      expect(source.currencyCode).toBeNull()
      expect(source.sourceUrl).toBe('https://spliit.app/groups/g1')
    }),
  )

  it.effect('accepts an empty currency code for custom currencies', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitExport({
        ...validExport,
        currency: '₽',
        currencyCode: '',
      })

      expect(source.currency).toBe('₽')
      expect(source.currencyCode).toBeNull()
      expect(source.expenses[0]?.amountCurrency).toBeNull()
    }),
  )

  it.effect('rejects duplicate upstream participant ids', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        parseSpliitExport({
          ...validExport,
          participants: [
            { id: 'dup', name: 'A' },
            { id: 'dup', name: 'B' },
          ],
        }),
      )
      expect(error.message).toMatch(/duplicate participant ids/i)
    }),
  )

  it.effect('rejects an expense that references an unknown paidById', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        parseSpliitExport({
          ...validExport,
          expenses: [
            {
              ...validExport.expenses[0],
              paidById: 'unknown-upstream-id',
            },
          ],
        }),
      )
      expect(error.message).toMatch(
        /Expense "Dures Bari" references an unknown participant\./,
      )
    }),
  )

  it.effect(
    'rejects an expense that references an unknown paidFor participantId',
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          parseSpliitExport({
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
          }),
        )
        expect(error.message).toMatch(
          /Expense "Dures Bari" references an unknown participant\./,
        )
      }),
  )

  it.effect('rejects an expense with duplicate paid-for participants', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        parseSpliitExport({
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
        }),
      )
      expect(error.message).toMatch(/duplicate paid-for participants/i)
    }),
  )

  it.effect('returns a clean error for a malformed export', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(parseSpliitExport({ id: 'no' }))
      expect(error.message).toBe(
        'This file is not a supported spliit.app JSON export.',
      )
    }),
  )

  it.effect('rejects an expense with a non-positive share', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        parseSpliitExport({
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
        }),
      )
      expect(error.message).toMatch(/non-positive share/i)
    }),
  )

  it.effect('scales BY_SHARES weights from whole shares into fixed units', () =>
    Effect.gen(function* () {
      // Legacy spliit.app JSON exports BY_SHARES as whole share counts; the
      // new internal contract stores hundredths so 1 share → 100, 2 → 200.
      const source = yield* parseSpliitExport({
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
      expect(source.expenses[0].splitMode).toBe('BY_SHARES')
      expect(source.expenses[0].paidFor).toEqual([
        { sourceId: 'spliit-participant-0', shares: 200 },
        { sourceId: 'spliit-participant-1', shares: 100 },
      ])
    }),
  )

  it.effect(
    'does not touch EVENLY/PERCENTAGE/AMOUNT weights when normalising',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSpliitExport({
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
        expect(source.expenses[0].paidFor).toEqual([
          { sourceId: 'spliit-participant-0', shares: 5000 },
          { sourceId: 'spliit-participant-1', shares: 5000 },
        ])
        expect(source.expenses[1].paidFor).toEqual([
          { sourceId: 'spliit-participant-0', shares: 2500 },
          { sourceId: 'spliit-participant-1', shares: 7500 },
        ])
      }),
  )
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

describe('complex spliit.app export exact values (folded from test-complex-import.test.ts)', () => {
  const fixturePath = path.resolve(
    __dirname,
    '../fixtures/spliit-export-features.json',
  )
  const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))

  it.effect('handles multi-currency fields', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitExport(raw)
      const mc = source.expenses.find((e) => e.originalAmount !== null)
      expect(mc).toBeDefined()
      expect(mc!.originalAmount).toBe(50000)
      expect(mc!.originalCurrency).toBe('USD')
      expect(mc!.conversionRate).toBe(0.9)
    }),
  )

  it.effect('resolves all numeric category IDs to string IDs', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitExport(raw)
      const cats = new Set(source.expenses.map((e) => e.category))
      // The export has categories like general, dining-out, rent, movies, etc.
      expect(cats.has('dining-out')).toBe(true)
      expect(cats.has('rent')).toBe(true)
      expect(cats.has('groceries')).toBe(true)
      expect(cats.has('gas-fuel')).toBe(true)
      expect(cats.has('settlement')).toBe(true)
    }),
  )

  it.effect('handles string conversionRate values', () =>
    Effect.gen(function* () {
      // The spliit.app export has conversionRate as a string "0.9"
      const modifiedRaw = JSON.parse(JSON.stringify(raw))
      const expenseWithString = modifiedRaw.expenses.find(
        (e: { originalAmount: unknown }) => e.originalAmount !== null,
      )
      if (expenseWithString) {
        expenseWithString.conversionRate = '0.9'
      }
      const source = yield* parseSpliitExport(modifiedRaw)
      {
        const mc = source.expenses.find((e) => e.originalAmount !== null)
        expect(mc?.conversionRate).toBe(0.9)
      }
    }),
  )
})
