import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { createImportTitleIndex } from './category-resolution'
import {
  parseDelimitedText,
  previewDelimitedRows,
  mapDelimitedRows,
  compileDelimitedMapping,
} from './generic-csv'
import {
  inferDelimitedExpenseMapping,
  inferNumberFormat,
  remainingMoneyDetections,
} from './inference'

function* parse(csv: string) {
  return yield* parseDelimitedText(csv)
}
function* sample(rows: string) {
  return yield* parse(`Date,Description,Amount,Category\n${rows}`)
}

describe('content-aware import inference', () => {
  it.effect('preserves a signed refund when the discriminator is blank', () =>
    Effect.gen(function* () {
      const table = yield* parse(
        'Date,Description,Amount,Type\n2022-03-14,Income,50,Income\n2022-03-15,Refund,-20,',
      )
      const { mapping } = inferDelimitedExpenseMapping(table, 'USD')
      expect(
        (yield* previewDelimitedRows(table, mapping)).map((row) => row.amount),
      ).toEqual([-5000, -2000])
    }),
  )
  it.effect('keeps descriptions containing numbers as title candidates', () =>
    Effect.gen(function* () {
      const table = yield* sample(
        '2022-03-14,Shop 123,50,\n2022-03-15,Merchant 456,20,',
      )
      const rows = yield* previewDelimitedRows(
        table,
        inferDelimitedExpenseMapping(table, 'USD').mapping,
      )
      expect(rows.map((row) => row.title)).toEqual(['Shop 123', 'Merchant 456'])
      expect(rows.every((row) => !row.error)).toBe(true)
    }),
  )
  it.effect(
    'extracts unambiguous symbols and blocks unresolved or conflicting currency evidence',
    () =>
      Effect.gen(function* () {
        for (const input of ['€50', '50 EUR']) {
          const table = yield* sample(`2022-03-14,Cafe,${input},`)
          expect(
            (yield* previewDelimitedRows(
              table,
              inferDelimitedExpenseMapping(table, 'USD').mapping,
            ))[0]?.currency,
          ).toBe('EUR')
        }
        for (const input of ['$50', '50 EUR USD']) {
          const table = yield* sample(`2022-03-14,Cafe,${input},`)
          const { mapping, detections } = inferDelimitedExpenseMapping(
            table,
            'USD',
          )
          expect(
            detections.some(
              (entry) =>
                entry.reason === 'CURRENCY' && entry.requiresConfirmation,
            ),
          ).toBe(true)
          expect(
            (yield* previewDelimitedRows(table, mapping))[0]?.issues.some(
              (issue) =>
                issue.field === 'currency' && issue.severity === 'error',
            ),
          ).toBe(true)
          expect(
            remainingMoneyDetections(
              detections,
              mapping.mappings.money,
              table,
            ).some((entry) => entry.reason === 'CURRENCY'),
          ).toBe(true)
          if (mapping.mappings.money.mode !== 'VISUAL')
            throw Error('Expected visual')
          const mappingWithoutCurrency = {
            ...mapping,
            mappings: {
              ...mapping.mappings,
              money: { ...mapping.mappings.money, currency: undefined },
            },
          }
          expect(
            remainingMoneyDetections(
              detections,
              mappingWithoutCurrency.mappings.money,
              table,
            ).filter((entry) => entry.field === 'money'),
          ).toEqual([])
        }
      }),
  )
  it.effect(
    'does not dismiss ambiguous numbers until the decimal format is chosen',
    () =>
      Effect.gen(function* () {
        const table = yield* sample('2022-03-14,Cafe,"1,234",')
        const { mapping, detections } = inferDelimitedExpenseMapping(
          table,
          'USD',
        )
        expect(
          remainingMoneyDetections(
            detections,
            mapping.mappings.money,
            table,
          ).some((entry) => entry.reason === 'NUMBER_FORMAT'),
        ).toBe(true)
        if (mapping.mappings.money.mode !== 'VISUAL')
          throw Error('Expected visual')
        const mappingWithFormat = {
          ...mapping,
          mappings: {
            ...mapping.mappings,
            money: {
              ...mapping.mappings.money,
              amount: {
                ...mapping.mappings.money.amount,
                transforms: [
                  { kind: 'PARSE_NUMBER', format: 'COMMA' } as const,
                ],
              },
            },
          },
        }
        expect(
          remainingMoneyDetections(
            detections,
            mappingWithFormat.mappings.money,
            table,
          ).filter((entry) => entry.field === 'money'),
        ).toEqual([])
        expect(
          (yield* previewDelimitedRows(table, mappingWithFormat))[0]?.amount,
        ).toBe(123)
      }),
  )
  it.effect('detects Debit/Credit pairs with an entirely empty lane', () =>
    Effect.gen(function* () {
      for (const [debit, credit, expected] of [
        ['', '100', -10000],
        ['100', '', 10000],
      ] as const) {
        const table = yield* parse(
          `Date,Description,Debit,Credit\n2022-03-14,Payment,${debit},${credit}`,
        )
        expect(
          (yield* previewDelimitedRows(
            table,
            inferDelimitedExpenseMapping(table, 'USD').mapping,
          ))[0]?.amount,
        ).toBe(expected)
      }
    }),
  )
  it.effect(
    'prefers populated duplicate headers, ignores balances and finds complementary title fallbacks',
    () =>
      Effect.gen(function* () {
        const table = yield* parse(
          'Date,Note,Note,Merchant,Amount,Balance\n3/14/2022,,Dinner,,50,9000\n3/15/2022,,,Cafe,20,8980',
        )
        const { mapping } = inferDelimitedExpenseMapping(table, 'USD')
        const rows = yield* previewDelimitedRows(table, mapping)
        expect(rows.map((row) => row.title)).toEqual(['Dinner', 'Cafe'])
        expect(rows.map((row) => row.amount)).toEqual([5000, 2000])
      }),
  )
  it.effect(
    'requires a source choice rather than mapping an account number as an amount',
    () =>
      Effect.gen(function* () {
        const { mapping, detections } = inferDelimitedExpenseMapping(
          yield* parse('Date,Description,Account\n2022-03-14,Cafe,12345'),
          'USD',
        )
        expect(
          detections.find((entry) => entry.field === 'money')
            ?.requiresConfirmation,
        ).toBe(true)
        expect(
          (yield* previewDelimitedRows(
            yield* parse('Date,Description,Account\n2022-03-14,Cafe,12345'),
            mapping,
          ))[0]?.error,
        ).toBeTruthy()
      }),
  )
  it.effect(
    'uses decisive DMY dates and number formats while reporting ambiguous formats',
    () =>
      Effect.gen(function* () {
        const { mapping } = inferDelimitedExpenseMapping(
          yield* sample('14/3/2022,Cafe,50,\n3/2/2022,Shop,20,'),
          'USD',
        )
        expect(
          (yield* previewDelimitedRows(
            yield* sample('14/3/2022,Cafe,50,\n3/2/2022,Shop,20,'),
            mapping,
          ))[1]?.expenseDate,
        ).toBe('2022-02-03')
        expect(inferNumberFormat(['1.234,56', '20,50'])).toEqual({
          format: 'COMMA',
          ambiguous: false,
        })
        expect(inferNumberFormat(['1,234', '2,456']).ambiguous).toBe(true)
        expect(inferNumberFormat(['12.50', '12,50']).ambiguous).toBe(true)
      }),
  )
  it.effect(
    'preserves signed amounts unless discriminator values are understood',
    () =>
      Effect.gen(function* () {
        const table = yield* parse(
          'Date,Description,Amount,Type\n2022-03-14,Salary,-50,ACH',
        )
        expect(
          (yield* previewDelimitedRows(
            table,
            inferDelimitedExpenseMapping(table, 'USD').mapping,
          ))[0]?.amount,
        ).toBe(-5000)
      }),
  )
  it.effect(
    'compiles editable debit/credit mappings and attributes invalid pairs to money',
    () =>
      Effect.gen(function* () {
        const table = yield* parse(
          'Date,Description,Debit,Credit\n2022-03-14,Cafe,50,0\n2022-03-15,Salary,,100\n2022-03-16,Both,5,6\n2022-03-17,Neither,0,\n2022-03-18,Signed,-1,',
        )
        const { mapping } = inferDelimitedExpenseMapping(table, 'USD')
        const rows = yield* previewDelimitedRows(table, mapping)
        expect(rows.slice(0, 2).map((row) => row.amount)).toEqual([
          5000, -10000,
        ])
        expect(rows[1]?.category).toBe('income')
        for (const row of rows.slice(2))
          expect(
            row.issues.some(
              (issue) => issue.field === 'amount' && issue.severity === 'error',
            ),
          ).toBe(true)
        if (mapping.mappings.money.mode !== 'VISUAL')
          throw new Error('Expected visual mapping')
        expect(
          compileDelimitedMapping(mapping.mappings.money.amount),
        ).toContain('debitCredit(')
      }),
  )
})

describe('local import categories', () => {
  it.effect(
    'learns the reviewed title instead of teaching its category to the original title',
    () =>
      Effect.gen(function* () {
        const table = yield* sample(
          '2022-03-14,Original merchant,50,\n2022-03-15,Original merchant,20,\n2022-03-16,Edited merchant,30,',
        )
        const { mapping } = inferDelimitedExpenseMapping(table, 'USD')
        const rows = yield* previewDelimitedRows(table, mapping, {
          categories: {
            explicitRows: { 2: 'groceries' },
            reviewedRows: { 2: { title: 'Edited merchant', amount: 5000 } },
          },
        })
        expect(rows.map((row) => row.category)).toEqual([
          'groceries',
          'general',
          'groceries',
        ])
        expect(rows[0]?.title).toBe('Edited merchant')
      }),
  )
  it.effect(
    'matches source labels, ignores bad labels per source, and preserves explicit General',
    () =>
      Effect.gen(function* () {
        const table = yield* sample(
          '2022-03-14,Uber,50,Groceris\n2022-03-15,Uber,20,Bad data',
        )
        const { mapping } = inferDelimitedExpenseMapping(table, 'USD')
        let rows = yield* previewDelimitedRows(table, mapping, {
          categories: { ignoredSources: ['bad data'] },
        })
        expect(rows[0]?.category).toBe('groceries')
        expect(rows[1]?.category).toBe('groceries') // Trusted same-title source evidence.
        const mappingWithTypo = {
          ...mapping,
          categoryBindings: {
            ...mapping.categoryBindings,
            groceris: 'general' as const,
          },
        }
        rows = yield* previewDelimitedRows(table, mappingWithTypo, {
          categories: { ignoredSources: ['bad data'] },
        })
        expect(rows[0]?.category).toBe('general')
        expect(rows[0]?.warning).toBeNull()
        expect(rows[1]?.category).toBe('taxi')
      }),
  )
  it.effect(
    'keeps title guesses per row and respects disabled suggestions and fallback',
    () =>
      Effect.gen(function* () {
        const table = yield* sample(
          '2022-03-14,Uber,50,Other\n2022-03-15,Unknown xyz,20,Other',
        )
        const { mapping: inferredMapping } = inferDelimitedExpenseMapping(
          table,
          'USD',
        )
        const mapping = {
          ...inferredMapping,
          defaults: {
            ...inferredMapping.defaults,
            categoryId: 'groceries' as const,
          },
        }
        const options = { ignoredSources: ['other'] }
        const rows = yield* previewDelimitedRows(table, mapping, {
          categories: options,
        })
        expect(rows.map((row) => row.category)).toEqual(['taxi', 'groceries'])
        expect(mapping.categoryBindings).toEqual({})
        expect(
          (yield* previewDelimitedRows(table, mapping, {
            categories: { ...options, suggestUnmatched: false },
          })).map((row) => row.category),
        ).toEqual(['groceries', 'groceries'])
      }),
  )
  it.effect(
    'uses history and explicit import choices without recursively learning guesses',
    () =>
      Effect.gen(function* () {
        const table = yield* sample(
          '2022-03-14,Zorb market,50,\n2022-03-15,Zorb market,20,\n2022-03-16,Zorb markat,10,',
        )
        const { mapping } = inferDelimitedExpenseMapping(table, 'USD')
        const categories = { explicitRows: { 2: 'groceries' as const } }
        const rows = yield* previewDelimitedRows(table, mapping, { categories })
        expect(rows.map((row) => row.category)).toEqual([
          'groceries',
          'groceries',
          'general',
        ])
        const mapped = yield* mapDelimitedRows(table, mapping, categories)
        expect(
          mapped.map((row) => [row.title, row.amount, row.category]),
        ).toEqual(rows.map((row) => [row.title, row.amount, row.category]))
        const historyRows = yield* previewDelimitedRows(table, mapping, {
          categories: {
            history: [
              { title: 'Zorb market', categoryId: 'groceries' },
              { title: 'Zorb market', categoryId: 'groceries' },
            ],
          },
        })
        expect(historyRows[2]?.category).toBe('groceries')
      }),
  )
  it.effect('produces identical categories in preview and final mapping', () =>
    Effect.gen(function* () {
      const table = yield* sample(
        '2022-03-14,Uber ride,50,Other\n2022-03-15,Unknown xyz,20,Other\n2022-03-16,Salary,-40,',
      )
      const { mapping: inferredMapping } = inferDelimitedExpenseMapping(
        table,
        'USD',
      )
      const mapping = {
        ...inferredMapping,
        defaults: {
          ...inferredMapping.defaults,
          categoryId: 'groceries' as const,
        },
      }
      const categories = {
        ignoredSources: ['other'],
        suggestUnmatched: true,
        history: [{ title: 'Uber ride', categoryId: 'groceries' as const }],
      }
      const preview = yield* previewDelimitedRows(table, mapping, {
        categories,
      })
      const mapped = yield* mapDelimitedRows(table, mapping, categories)
      expect(
        mapped.map((row) => [row.title, row.amount, row.category]),
      ).toEqual(preview.map((row) => [row.title, row.amount, row.category]))
      // Disabled suggestions still match between preview and final mapping.
      const off = { ...categories, suggestUnmatched: false }
      expect(
        (yield* mapDelimitedRows(table, mapping, off)).map(
          (row) => row.category,
        ),
      ).toEqual(
        (yield* previewDelimitedRows(table, mapping, { categories: off })).map(
          (row) => row.category,
        ),
      )
    }),
  )
  it.effect(
    'does not propagate conflicting imported choices or infer accounting categories',
    () =>
      Effect.gen(function* () {
        const table = yield* sample(
          '2022-03-14,Zorb,50,\n2022-03-15,Zorb,20,\n2022-03-16,Zorb,10,\n2022-03-17,Salary,-40,',
        )
        const { mapping } = inferDelimitedExpenseMapping(table, 'USD')
        const rows = yield* previewDelimitedRows(table, mapping, {
          categories: {
            explicitRows: { 2: 'groceries', 3: 'taxi' },
            history: [{ title: 'Zorb', categoryId: 'income' }],
          },
        })
        expect(rows[2]?.category).toBe('general')
        expect(rows[3]?.category).toBe('income')
      }),
  )
  it('separates exact and fuzzy title candidates without changing meaningful digits', () => {
    const match = createImportTitleIndex(
      ['Zorb 12', 'Zorb 13', 'Zarb 12', 'ZORB 12'],
      (value) => value,
    )('Zorb 12')
    expect(match.exact).toEqual(['Zorb 12', 'ZORB 12'])
    expect(match.fuzzy).toEqual(['Zarb 12'])
  })
  it.effect(
    'evaluates ten thousand rows with repeated and unique titles',
    () =>
      Effect.gen(function* () {
        const table = yield* sample(
          Array.from(
            { length: 10000 },
            (_, index) =>
              `2022-03-14,${index % 2 ? 'Uber' : `Merchant ${index}`},10,`,
          ).join('\n'),
        )
        const { mapping } = inferDelimitedExpenseMapping(table, 'USD')
        const rows = yield* previewDelimitedRows(table, mapping, {
          categories: {
            history: Array.from({ length: 200 }, (_, index) => ({
              title: `Merchant ${index}`,
              categoryId: 'groceries',
            })),
          },
        })
        expect(rows).toHaveLength(10000)
        expect(rows[9999]?.category).toBe('taxi')
      }),
    15000,
  )
  it.effect('infers a lone Credit column as the amount source', () =>
    Effect.gen(function* () {
      const table = yield* parse(
        'Date,Description,Credit\n2022-03-14,Refund A,100\n2022-03-15,Refund B,200',
      )
      const { mapping, detections } = inferDelimitedExpenseMapping(table, 'USD')
      expect(
        detections.find((entry) => entry.field === 'money')
          ?.requiresConfirmation,
      ).toBe(false)
      expect(
        (yield* previewDelimitedRows(table, mapping)).map((row) => row.amount),
      ).toEqual([10000, 20000])
    }),
  )
  it.effect('lets a manual override beat the negative-amount income rule', () =>
    Effect.gen(function* () {
      const table = yield* sample(
        '2022-03-14,Refund,-50,\n2022-03-15,Salary,-40,',
      )
      const { mapping } = inferDelimitedExpenseMapping(table, 'USD')
      const rows = yield* previewDelimitedRows(table, mapping, {
        categories: { explicitRows: { 2: 'groceries' } },
      })
      expect(rows[0]?.category).toBe('groceries')
      expect(rows[0]?.categoryProvenance).toBe('manual')
      expect(rows[1]?.category).toBe('income')
      const mapped = yield* mapDelimitedRows(table, mapping, {
        explicitRows: { 2: 'groceries' },
      })
      expect(mapped[0]?.category).toBe('groceries')
    }),
  )
})

describe('csv import follow-ups', () => {
  it.effect('ignores mixed-case bad labels per normalized source', () =>
    Effect.gen(function* () {
      const table = yield* sample(
        '2022-03-14,Uber,50,Bad Data\n2022-03-15,Uber,20,bad data',
      )
      const { mapping } = inferDelimitedExpenseMapping(table, 'USD')
      const rows = yield* previewDelimitedRows(table, mapping, {
        categories: { ignoredSources: ['Bad Data'] },
      })
      expect(rows.map((row) => row.category)).toEqual(['taxi', 'taxi'])
    }),
  )
  it.effect('infers a lone Debit column as the amount source', () =>
    Effect.gen(function* () {
      const table = yield* parse(
        'Date,Description,Debit\n2022-03-14,Payment A,100\n2022-03-15,Payment B,200',
      )
      const { mapping, detections } = inferDelimitedExpenseMapping(table, 'USD')
      expect(
        detections.find((entry) => entry.field === 'money')
          ?.requiresConfirmation,
      ).toBe(false)
      expect(
        (yield* previewDelimitedRows(table, mapping)).map((row) => row.amount),
      ).toEqual([10000, 20000])
    }),
  )
  it.effect('marks paired Debit/Credit lanes as confirmed', () =>
    Effect.gen(function* () {
      const table = yield* parse(
        'Date,Description,Debit,Credit\n2022-03-14,Payment,100,\n2022-03-15,Refund,,50',
      )
      const { mapping, detections } = inferDelimitedExpenseMapping(table, 'USD')
      const money = detections.find((entry) => entry.field === 'money')
      expect(money?.requiresConfirmation).toBe(false)
      expect(money?.candidates).toEqual(
        expect.arrayContaining([expect.stringMatching(/debit/i)]),
      )
      expect(
        (yield* previewDelimitedRows(table, mapping)).map((row) => row.amount),
      ).toEqual([10000, -5000])
    }),
  )
  it.effect(
    'commits identical preview and final categories with stripped portable bindings',
    () =>
      Effect.gen(function* () {
        const table = yield* sample('2022-03-14,Uber ride,50,Other')
        const { mapping } = inferDelimitedExpenseMapping(table, 'USD')
        const preview = yield* previewDelimitedRows(table, mapping, {
          categories: { ignoredSources: ['other'] },
        })
        const mapped = yield* mapDelimitedRows(table, mapping, {
          ignoredSources: ['other'],
        })
        expect(mapped.map((row) => row.category)).toEqual(
          preview.map((row) => row.category),
        )
      }),
  )
  it.effect(
    'penalizes quantity columns so the price column wins the amount',
    () =>
      Effect.gen(function* () {
        const table = yield* parse(
          'Date,Description,Quantity,Price\n2022-03-14,Meal,2,50\n2022-03-15,Snack,1,20',
        )
        const { mapping } = inferDelimitedExpenseMapping(table, 'USD', 'MDY')
        const money = mapping.mappings.money
        expect(money.mode).toBe('VISUAL')
        // A blind accept must import prices (5000/2000c), never counts (200/100c).
        expect(
          money.mode === 'VISUAL'
            ? money.amount.sourceValues[0]?.primary
            : undefined,
        ).toBe('price#1')
      }),
  )
  it.effect(
    'prefers the Cost column over per-person balance columns without blocking',
    () =>
      Effect.gen(function* () {
        const table = yield* parse(
          'Date,Description,Category,Currency,Cost,Sarka,Diego\n2026-04-04,Dinner,Dining Out,EUR,61.00,-30.5,30.5\n2026-04-04,Market,Groceries,EUR,7.85,-3.92,3.93',
        )
        const { mapping, detections } = inferDelimitedExpenseMapping(
          table,
          'EUR',
          'MDY',
        )
        expect(
          detections.find((entry) => entry.field === 'money')
            ?.requiresConfirmation,
        ).toBe(false)
        expect(mapping.mappings.money.mode).toBe('VISUAL')
        if (mapping.mappings.money.mode !== 'VISUAL')
          throw new Error('Expected visual money')
        expect(mapping.mappings.money.amount.sourceValues[0]?.primary).toBe(
          'cost#1',
        )
      }),
  )
  it.effect('refuses to claim the same column as both date and title', () =>
    Effect.gen(function* () {
      const table = yield* parse(
        'Info,Amount\nMeeting 3/2/2022,50\nLunch 4/2/2022,20',
      )
      const { mapping, detections } = inferDelimitedExpenseMapping(
        table,
        'USD',
        'MDY',
      )
      const dateTime = mapping.mappings.dateTime
      const title = mapping.mappings.title
      // The date column also reads as prose, so its confident pick is suspect
      // (its values can never strictly parse as dates) — force confirmation…
      expect(
        detections.find((entry) => entry.field === 'dateTime')
          ?.requiresConfirmation,
      ).toBe(true)
      // …and the title must not double-claim the date column.
      expect(
        title?.mode === 'VISUAL' ? title.sourceValues[0]?.primary : undefined,
      ).not.toBe(
        dateTime?.mode === 'VISUAL'
          ? dateTime.sourceValues[0]?.primary
          : undefined,
      )
      expect(
        detections.find((entry) => entry.field === 'title')
          ?.requiresConfirmation,
      ).toBe(true)
    }),
  )
  it.effect('profiles textual month dates as dates', () =>
    Effect.gen(function* () {
      const table = yield* parse(
        'Date,Title,Amount\n14-Mar-2022,Meal,10\n"Mar 4, 2022",Snack,20',
      )
      const { mapping } = inferDelimitedExpenseMapping(table, 'USD', 'MDY')
      const dateTime = mapping.mappings.dateTime
      expect(
        dateTime?.mode === 'VISUAL'
          ? dateTime.sourceValues[0]?.primary
          : undefined,
      ).toBe('date#1')
    }),
  )
  it.effect('prefers qualified amount headers over a bare total', () =>
    Effect.gen(function* () {
      for (const header of ['Amount INR', 'Total Amount']) {
        const table = yield* parse(
          `Date,Description,${header},Total\n2022-03-14,Cafe,50,9000\n2022-03-15,Shop,20,8980`,
        )
        const { mapping } = inferDelimitedExpenseMapping(table, 'USD', 'MDY')
        expect(mapping.mappings.money.mode).toBe('VISUAL')
        if (mapping.mappings.money.mode !== 'VISUAL')
          throw new Error('Expected visual money')
        // Word-boundary matching gives `Amount INR`/`Total Amount` the amount
        // bonus so they beat the bare `Total` column.
        expect(mapping.mappings.money.amount.sourceValues[0]?.primary).not.toBe(
          'total#1',
        )
      }
      // Exact `Amount`/`Total` behavior is unchanged.
      const exact = yield* parse(
        'Date,Description,Amount,Total\n2022-03-14,Cafe,50,9000\n2022-03-15,Shop,20,8980',
      )
      const { mapping } = inferDelimitedExpenseMapping(exact, 'USD', 'MDY')
      expect(mapping.mappings.money.mode).toBe('VISUAL')
      if (mapping.mappings.money.mode !== 'VISUAL')
        throw new Error('Expected visual money')
      expect(mapping.mappings.money.amount.sourceValues[0]?.primary).toBe(
        'amount#1',
      )
    }),
  )
  it.effect(
    'prefers exact amount/total headers over qualified lookalikes',
    () =>
      Effect.gen(function* () {
        const table = yield* parse(
          'Date,Description,Amount,Corrected amount\n2022-03-14,Cafe,50,51\n2022-03-15,Shop,20,22',
        )
        const { mapping } = inferDelimitedExpenseMapping(table, 'USD', 'MDY')
        expect(mapping.mappings.money.mode).toBe('VISUAL')
        if (mapping.mappings.money.mode !== 'VISUAL')
          throw new Error('Expected visual money')
        // Exact `Amount` (5 pts) outranks `Corrected amount` (4 pts); without
        // tiering the two tie and the pick is arbitrary.
        expect(mapping.mappings.money.amount.sourceValues[0]?.primary).toBe(
          'amount#1',
        )
        const totals = yield* parse(
          'Date,Description,Total,Subtotal\n2022-03-14,Cafe,50,51\n2022-03-15,Shop,20,22',
        )
        const { mapping: totalMapping } = inferDelimitedExpenseMapping(
          totals,
          'USD',
          'MDY',
        )
        expect(totalMapping.mappings.money.mode).toBe('VISUAL')
        if (totalMapping.mappings.money.mode !== 'VISUAL')
          throw new Error('Expected visual money')
        expect(
          totalMapping.mappings.money.amount.sourceValues[0]?.primary,
        ).toBe('total#1')
      }),
  )
  it.effect('ignores category sources across spacing and punctuation', () =>
    Effect.gen(function* () {
      const table = yield* parse(
        'Date,Description,Amount,Category\n2022-03-14,Uber,50,Food / Drinks\n2022-03-15,Uber,20,food/drinks',
      )
      const { mapping } = inferDelimitedExpenseMapping(table, 'USD')
      const rows = yield* previewDelimitedRows(table, mapping, {
        categories: { ignoredSources: ['food/drinks'] },
      })
      // Both spellings collapse to `food/drinks`, so both rows ignore the source
      // and fall back to the title guess instead of the source dictionary.
      expect(rows.map((row) => row.category)).toEqual(['taxi', 'taxi'])
    }),
  )
})
