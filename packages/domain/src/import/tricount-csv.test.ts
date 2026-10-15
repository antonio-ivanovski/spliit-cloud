import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { parseTricountCsv, parseTricountCsvSingle } from './tricount-csv'
import { ImportError } from './types'

const GDPR_HEADER =
  'Title;Amount;Currency;Exchange rate;Amount in default currency (EUR);Transaction type;Category;Paid by;Date & time;Paid by Alex;Impacted to Alex;Paid by Julia;Impacted to Julia'

const GDPR_ROWS = [
  'Hotel;-85.00;USD;1.08;-78.70;NORMAL;Housing;Alex;2018-10-16 17:46:56;85;42.50;0;42.50',
  'Picnic;-13.00;EUR;1;13.00;NORMAL;Food;Julia;2018-10-17 12:00:00;0;6.50;13;6.50',
  'repayment Julia;-20.00;EUR;1;20.00;BALANCE;Transfer;Alex;2018-10-18 09:00:00;20;0;0;20',
  'tricount City trip - Exported on 2024-02-05;;;;;;;',
].join('\n')

const GDPR_CSV = `${GDPR_HEADER}\n${GDPR_ROWS}`

const SESTERCE_CSV = [
  'Date,Title,Paid by Pierre,Paid by Sophie,Paid for Pierre,Paid for Sophie,Currency,Category,Exchange rate',
  '20230722,Hotel aBis,358.0,0.0,169.0,189.0,EUR,Hosting,1',
].join('\n')

describe('parseTricountCsv (GDPR multi-group)', () => {
  it.effect('parses expenses with shares through domain core', () =>
    Effect.gen(function* () {
      const sources = yield* parseTricountCsv(GDPR_CSV)
      expect(sources).toHaveLength(1)
      const source = sources[0]!
      expect(source.provider).toBe('TRICOUNT')
      expect(source.name).toBe('City trip')
      expect(source.currencyCode).toBe('EUR')
      expect(source.participants.map((p) => p.sourceName).sort()).toEqual([
        'Alex',
        'Julia',
      ])
      expect(source.expenses).toHaveLength(3)

      const hotel = source.expenses.find((e) => e.title === 'Hotel')!
      expect(hotel.amount).toBe(8500)
      expect(hotel.amountCurrency).toBe('USD')
      expect(hotel.paidFor.reduce((s, p) => s + p.shares, 0)).toBe(8500)
      expect(hotel.conversionRate).toBeCloseTo(1.08, 5)

      const settlement = source.expenses.find(
        (e) => e.title === 'repayment Julia',
      )!
      expect(settlement.category).toBe('settlement')
      expect(settlement.paidFor).toHaveLength(1)
    }),
  )

  it.effect('accepts the Sesterce Paid by / Paid for shape', () =>
    Effect.gen(function* () {
      const sources = yield* parseTricountCsv(SESTERCE_CSV)
      expect(sources).toHaveLength(1)
      const expense = sources[0]!.expenses[0]!
      expect(expense.title).toBe('Hotel aBis')
      expect(expense.expenseDate).toBe('2023-07-22')
      expect(expense.amount).toBe(35800)
      expect(expense.paidFor.reduce((s, p) => s + p.shares, 0)).toBe(35800)
    }),
  )

  it.effect('splits multi-group dumps with footer names', () =>
    Effect.gen(function* () {
      const second = GDPR_CSV.replace('City trip', 'Mountain hut')
      const sources = yield* parseTricountCsv(`${GDPR_CSV}\n${second}`)
      expect(sources).toHaveLength(2)
      expect(sources.map((s) => s.name)).toEqual(['City trip', 'Mountain hut'])
      expect(sources[0]!.sourceGroupId).not.toBe(sources[1]!.sourceGroupId)
    }),
  )

  it.effect('rejects non-Tricount CSVs with a stable code', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(parseTricountCsv('a,b,c\n1,2,3\n'))
      expect(failure).toBeInstanceOf(ImportError)
      expect(failure.code).toBe('CSV_NOT_TRICOUNT_EXPORT')
    }),
  )

  it.effect('single variant routes multi-group dumps to the picker', () =>
    Effect.gen(function* () {
      const second = GDPR_CSV.replace('City trip', 'Mountain hut')
      const failure = yield* Effect.flip(
        parseTricountCsvSingle(`${GDPR_CSV}\n${second}`),
      )
      expect(failure.code).toBe('CSV_MULTIPLE_GROUPS')
      expect(failure.params).toEqual({ count: 2 })
    }),
  )

  it.effect('single variant resolves one group', () =>
    Effect.gen(function* () {
      const source = yield* parseTricountCsvSingle(GDPR_CSV)
      expect(source.name).toBe('City trip')
    }),
  )
})
