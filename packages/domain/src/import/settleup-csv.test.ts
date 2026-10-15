import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { settleUpCategoryToId } from './settleup-categories'
import { decodeSettleUpText, parseSettleUpCsv } from './settleup-csv'
import { mapSettleUpHeader } from './settleup-headers'
import type { NormalizedSource } from './types'
import { ImportError } from './types'

const HEADER =
  '"Who paid","Amount","Currency","For whom","Split amounts","Purpose","Category","Date & time","Timezone","Exchange rate","Converted amount","Type","Receipt"'

/** Build a real-shape row in fixed column order (mirrors the fixtures). */
function row(cells: {
  paid: string
  amount: string
  currency?: string
  forWhom: string
  splits: string
  purpose?: string
  category?: string
  date?: string
  tz?: string
  rate?: string
  converted?: string
  type?: string
}): string {
  const values = [
    cells.paid,
    cells.amount,
    cells.currency ?? 'EUR',
    cells.forWhom,
    cells.splits,
    cells.purpose ?? '',
    cells.category ?? ' ',
    cells.date ?? '2024-01-15 12:00:00',
    cells.tz ?? '+02:00',
    cells.rate ?? '',
    cells.converted ?? cells.amount,
    cells.type ?? 'expense',
    '',
  ]
  return values.map((v) => `"${v}"`).join(',')
}

function csv(lines: string[]): string {
  return [HEADER, ...lines].join('\n')
}

/** Raw fixture bytes (UTF-16LE with BOM, exactly as exported). */
function readFixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(__dirname, '../fixtures', name)))
}

/** Recompute net balances (paid − owed) per participant. */
function netBalances(source: NormalizedSource): Map<string, number> {
  const balances = new Map<string, number>()
  for (const p of source.participants) balances.set(p.sourceId, 0)
  for (const expense of source.expenses) {
    for (const paid of expense.paidBy) {
      balances.set(
        paid.sourceId,
        (balances.get(paid.sourceId) ?? 0) + paid.shares,
      )
    }
    for (const owed of expense.paidFor) {
      balances.set(
        owed.sourceId,
        (balances.get(owed.sourceId) ?? 0) - owed.shares,
      )
    }
  }
  return balances
}

describe('parseSettleUpCsv', () => {
  it.effect(
    'parses For whom / Split amounts pairs through the domain core',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSettleUpCsv(
          csv([
            row({
              paid: 'Alex',
              amount: '358.00',
              forWhom: 'Alex;Sam',
              splits: '169.00;189.00',
              purpose: 'Hotel',
              category: '🏨',
            }),
          ]),
        )
        expect(source.provider).toBe('SETTLEUP')
        expect(source.name).toBe('Imported from Settle Up')
        expect(source.currencyCode).toBe('EUR')
        expect(source.participants.map((p) => p.sourceName)).toEqual([
          'Alex',
          'Sam',
        ])
        expect(source.expenses).toHaveLength(1)

        const hotel = source.expenses[0]!
        expect(hotel.title).toBe('Hotel')
        expect(hotel.amount).toBe(35800)
        expect(hotel.amountCurrency).toBe('EUR')
        expect(hotel.expenseDate).toBe('2024-01-15')
        expect(hotel.category).toBe('hotel')
        expect(hotel.paidBySourceId).toBe('settleup-participant-0')
        expect(hotel.paidFor.reduce((s, p) => s + p.shares, 0)).toBe(35800)
      }),
  )

  it.effect('keeps an even split EVENLY', () =>
    Effect.gen(function* () {
      const source = yield* parseSettleUpCsv(
        csv([
          row({
            paid: 'Alex',
            amount: '40.00',
            forWhom: 'Alex;Sam',
            splits: '20.00;20.00',
            purpose: 'Dinner',
          }),
        ]),
      )
      expect(source.expenses[0]!.splitMode).toBe('EVENLY')
    }),
  )

  it.effect('detects uneven splits as BY_SHARES', () =>
    Effect.gen(function* () {
      const source = yield* parseSettleUpCsv(
        csv([
          row({
            paid: 'Alex',
            amount: '400.00',
            forWhom: 'Alex;Sam',
            splits: '100.00;300.00',
            purpose: 'Dinner',
          }),
        ]),
      )
      const expense = source.expenses[0]!
      expect(expense.splitMode).toBe('BY_SHARES')
      expect(expense.paidFor).toEqual([
        { sourceId: 'settleup-participant-0', shares: 100 },
        { sourceId: 'settleup-participant-1', shares: 300 },
      ])
    }),
  )

  it.effect('imports transfers as settlements', () =>
    Effect.gen(function* () {
      const source = yield* parseSettleUpCsv(
        csv([
          row({
            paid: 'Alex',
            amount: '20.00',
            forWhom: 'Sam',
            splits: '20.00',
            purpose: 'Repayment',
            type: 'transfer',
          }),
        ]),
      )
      const settlement = source.expenses[0]!
      expect(settlement.category).toBe('settlement')
      expect(settlement.paidFor).toHaveLength(1)
      expect(settlement.paidFor[0]!.sourceId).toBe('settleup-participant-1')
    }),
  )

  it.effect('marks negative totals as income', () =>
    Effect.gen(function* () {
      const source = yield* parseSettleUpCsv(
        csv([
          row({
            paid: 'Alex',
            amount: '-60.00',
            forWhom: 'Alex;Sam',
            splits: '30.00;30.00',
            purpose: 'Deposit refund',
          }),
        ]),
      )
      const income = source.expenses[0]!
      expect(income.category).toBe('income')
      expect(income.amount).toBe(6000)
      expect(income.paidFor.reduce((s, p) => s + p.shares, 0)).toBe(6000)
    }),
  )

  it.effect('preserves the historical exchange rate', () =>
    Effect.gen(function* () {
      const source = yield* parseSettleUpCsv(
        csv([
          row({
            paid: 'Alex',
            amount: '200.00',
            currency: 'CZK',
            forWhom: 'Alex;Sam',
            splits: '100.00;100.00',
            purpose: 'Pivo',
            category: '🍺',
            rate: '27.05',
            converted: '7.40',
          }),
        ]),
      )
      const expense = source.expenses[0]!
      expect(expense.amount).toBe(20000)
      expect(expense.amountCurrency).toBe('CZK')
      expect(expense.conversionRate).toBeCloseTo(27.05, 5)
    }),
  )

  it.effect(
    'falls back to a payer → receivers title when Purpose is empty',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSettleUpCsv(
          csv([
            row({
              paid: 'Alex',
              amount: '40.00',
              forWhom: 'Alex;Sam',
              splits: '20.00;20.00',
            }),
          ]),
        )
        expect(source.expenses[0]!.title).toBe('Alex → Sam')
      }),
  )

  it.effect('registers For whom names the payer row introduces', () =>
    Effect.gen(function* () {
      const source = yield* parseSettleUpCsv(
        csv([
          row({
            paid: 'Alex',
            amount: '30.00',
            forWhom: 'Alex;Sam;Jo',
            splits: '10.00;10.00;10.00',
            purpose: 'Lunch',
          }),
        ]),
      )
      expect(source.participants.map((p) => p.sourceName)).toEqual([
        'Alex',
        'Sam',
        'Jo',
      ])
    }),
  )

  it.effect('rejects rows whose splits cannot align with names', () =>
    Effect.gen(function* () {
      // No parseable rows at all: empty expense list (not a crash).
      const failure = yield* Effect.flip(
        parseSettleUpCsv(
          csv([
            row({
              paid: 'Alex',
              amount: '40.00',
              forWhom: '',
              splits: '',
              purpose: 'Dinner',
            }),
          ]),
        ),
      )
      expect(failure.code).toBe('CSV_NO_PARSEABLE_EXPENSES')
    }),
  )

  it.effect('rejects non-Settle Up CSVs with a stable code', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(parseSettleUpCsv('a,b,c\n1,2,3\n'))
      expect(failure).toBeInstanceOf(ImportError)
      expect(failure.code).toBe('CSV_NOT_SETTLEUP_EXPORT')
    }),
  )

  it.effect('rejects Splitwise-shape files (no For whom column)', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        parseSettleUpCsv(
          'Date,Description,Category,Cost,Currency,Alex,Sam\n2024-01-15,Dinner,,40.00,EUR,20.00,-20.00',
        ),
      )
      expect(failure.code).toBe('CSV_NOT_SETTLEUP_EXPORT')
    }),
  )

  it.effect('errors when no rows survive validation', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        parseSettleUpCsv(
          `${HEADER}\n"Alex","40.00","EUR","","",""," ","not-a-date","+02:00","","40.00","expense",""`,
        ),
      )
      expect(failure.code).toBe('CSV_NO_PARSEABLE_EXPENSES')
    }),
  )
})

describe('settle-up fixtures', () => {
  it.effect(
    'ad-settle-up: decodes UTF-16 and imports the transfer as a settlement',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSettleUpCsv(
          readFixtureBytes('ad-settle-up.csv'),
        )
        expect(source.provider).toBe('SETTLEUP')
        expect(source.currencyCode).toBe('MKD')
        expect(source.participants.map((p) => p.sourceName)).toEqual([
          'Antonio Ivanovski',
          'Dejan Ivanovski',
        ])
        expect(source.expenses).toHaveLength(2)

        const [transfer, expense] = source.expenses
        // `Imported balance` transfer row → settlement payer → receiver.
        expect(transfer!.category).toBe('settlement')
        expect(transfer!.amount).toBe(358200)
        expect(transfer!.title).toBe('Imported balance')
        expect(transfer!.paidBySourceId).toBe('settleup-participant-0')
        expect(transfer!.paidFor).toEqual([
          { sourceId: 'settleup-participant-1', shares: 358200 },
        ])
        // Empty-Purpose expense row → payer → receivers fallback title.
        expect(expense!.title).toBe('Antonio Ivanovski → Dejan Ivanovski')
        expect(expense!.amount).toBe(7683900)
        expect(expense!.splitMode).toBe('EVENLY')
        expect(expense!.paidFor.reduce((s, p) => s + p.shares, 0)).toBe(7683900)

        // Balances net to zero across the group.
        const balances = netBalances(source)
        const total = [...balances.values()].reduce((s, v) => s + v, 0)
        expect(total).toBe(0)
      }),
  )

  it.effect(
    'gr-settle-up: imports all four expenses with every receiver attached',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSettleUpCsv(
          readFixtureBytes('gr-settle-up.csv'),
        )
        expect(source.provider).toBe('SETTLEUP')
        expect(source.currencyCode).toBe('EUR')
        expect(source.participants).toHaveLength(12)
        expect(source.participants.map((p) => p.sourceName)).toEqual([
          'Angelina Kichukova',
          'Antonio Ivanovski',
          'Ljubomir Ignov',
          'Marija Popova',
          'Martin Ramov',
          'Panche Chavkovski',
          'Simona Stamenkova',
          'Stefan Stanoeski',
          'Анѓел Кичуков',
          'Благој Ѓорчевски',
          'Иван Кичуков',
          'Миле',
        ])
        expect(source.expenses).toHaveLength(4)

        for (const expense of source.expenses) {
          // 12 receivers each, paidFor sums to the row total exactly.
          expect(expense.paidFor).toHaveLength(12)
          expect(expense.paidFor.reduce((s, p) => s + p.shares, 0)).toBe(
            expense.amount,
          )
          // Empty Purpose rows fall back to payer → receiver-list titles.
          expect(expense.title).toContain('→')
          expect(expense.amountCurrency).toBe('EUR')
          expect(expense.expenseDate).toBe('2026-10-15')
        }
        expect(source.expenses[0]!.amount).toBe(10000)
        expect(source.expenses[3]!.amount).toBe(287200)
        expect(source.expenses[3]!.paidBySourceId).toBe(
          'settleup-participant-8',
        )

        // 8.33 × 12 = 99.96 vs 100.00: the 4-cent rounding remainder lands
        // on the payer, keeping every row exact.
        const first = source.expenses[0]!
        expect(first.paidFor[0]!.shares).toBe(837)
        expect(first.paidFor.slice(1).every((p) => p.shares === 833)).toBe(true)

        const balances = netBalances(source)
        const total = [...balances.values()].reduce((s, v) => s + v, 0)
        expect(total).toBe(0)
      }),
  )

  it.effect(
    'both fixtures import single-currency groups with decoded names',
    () =>
      Effect.gen(function* () {
        const ad = yield* parseSettleUpCsv(readFixtureBytes('ad-settle-up.csv'))
        const gr = yield* parseSettleUpCsv(readFixtureBytes('gr-settle-up.csv'))
        // One group, one currency: every expense matches the group currency.
        for (const source of [ad, gr]) {
          for (const expense of source.expenses) {
            expect(expense.amountCurrency).toBe(source.currencyCode)
          }
        }
        // UTF-16 Cyrillic names survive decoding (payer and receivers alike).
        expect(gr.participants.map((g) => g.sourceName)).toContain(
          'Анѓел Кичуков',
        )
        expect(gr.participants.map((g) => g.sourceName)).toContain('Миле')
      }),
  )
})

describe('decodeSettleUpText', () => {
  it('decodes UTF-16LE bytes with a BOM', () => {
    const bytes = readFixtureBytes('ad-settle-up.csv')
    const text = decodeSettleUpText(bytes)
    expect(text).not.toBeNull()
    expect(text!.split('\n', 1)[0]).toContain('Who paid')
  })

  it('decodes UTF-16BE bytes with a BOM', () => {
    const le = 'A,B\n1,2\n'
    const units = [0xfe, 0xff]
    for (const ch of le) {
      const code = ch.charCodeAt(0)
      units.push((code >> 8) & 0xff, code & 0xff)
    }
    const beBytes = new Uint8Array(units)
    expect(decodeSettleUpText(beBytes)).toBe(le)
  })

  it('passes UTF-8 text through untouched', () => {
    const text = `${HEADER}\n`
    expect(decodeSettleUpText(text)).toBe(text)
    expect(decodeSettleUpText(new TextEncoder().encode(text))).toBe(text)
  })

  it('rejects undecodable payloads', () => {
    expect(decodeSettleUpText(new Uint8Array([0xff, 0xfe, 0x00]))).toBeNull()
    expect(decodeSettleUpText(new Uint8Array([]))).toBeNull()
  })
})

describe('mapSettleUpHeader', () => {
  it('maps the canonical real-export header', () => {
    const map = mapSettleUpHeader([
      'Who paid',
      'Amount',
      'Currency',
      'For whom',
      'Split amounts',
      'Purpose',
      'Category',
      'Date & time',
      'Timezone',
      'Exchange rate',
      'Converted amount',
      'Type',
      'Receipt',
    ])
    expect(map).not.toBeNull()
    expect(map).toMatchObject({
      purposeIdx: 5,
      amountIdx: 1,
      currencyIdx: 2,
      forWhomIdx: 3,
      splitAmountsIdx: 4,
      paidByIdx: 0,
      categoryIdx: 6,
      dateTimeIdx: 7,
      exchangeRateIdx: 9,
      convertedAmountIdx: 10,
      typeIdx: 11,
    })
  })

  it('rejects headers without Who paid', () => {
    expect(
      mapSettleUpHeader(['Amount', 'Currency', 'For whom', 'Purpose']),
    ).toBeNull()
  })

  it('rejects headers without For whom', () => {
    expect(
      mapSettleUpHeader(['Who paid', 'Amount', 'Currency', 'Purpose']),
    ).toBeNull()
  })

  it('rejects headers without an amount column', () => {
    expect(
      mapSettleUpHeader(['Who paid', 'For whom', 'Currency', 'Purpose']),
    ).toBeNull()
  })
})

describe('settleUpCategoryToId', () => {
  it('maps built-in emoji', () => {
    expect(settleUpCategoryToId('🛒', '')).toBe('groceries')
    expect(settleUpCategoryToId('✈', '')).toBe('plane')
  })

  it('matches free-text names by keyword', () => {
    expect(settleUpCategoryToId('Restaurant U Fleků', '')).toBe('dining-out')
    expect(settleUpCategoryToId('Miete August', '')).toBe('rent')
  })

  it('treats transfer types as settlements', () => {
    expect(settleUpCategoryToId('', 'transfer')).toBe('settlement')
  })

  it('falls back to general', () => {
    expect(settleUpCategoryToId('', '')).toBe('general')
    expect(settleUpCategoryToId('something unknown', '')).toBe('general')
  })
})
