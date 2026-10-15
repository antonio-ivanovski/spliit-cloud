import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import Papa from 'papaparse'

import { parseSpliitCsv } from './spliit-csv'
import { recoverSpliitOriginalAmount } from './spliit-original-amount'

const sampleCsv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John ","Jane"
"2026-01-12","Kafe plazha ","Dining Out","EUR","3.60",,,,"No","Unevenly – By shares",-2.16,1.44
"2026-01-12","Kirija + gas ","Gas/Fuel","EUR","474.00",,,,"No","Unevenly – By shares",284.4,-189.6
"2025-12-08","Gas","Gas/Fuel","EUR","67.50",,,,"No","Unevenly – By shares",45,-22.5
"2025-12-08","Gelato Esmeralda","Food and Drink","EUR","9.00",,,,"No","Unevenly – By shares",5.4,-3.6`

describe('papaparse-backed CSV primitives', () => {
  it('parses a simple row', () => {
    const out = Papa.parse<string[]>('a,b,c', { header: false })
    expect(out.data).toEqual([['a', 'b', 'c']])
  })
  it('parses quoted fields with embedded commas', () => {
    const out = Papa.parse<string[]>('"a,b",c', { header: false })
    expect(out.data).toEqual([['a,b', 'c']])
  })
  it('parses escaped double-quotes', () => {
    const out = Papa.parse<string[]>('"a""b",c', { header: false })
    expect(out.data).toEqual([['a"b', 'c']])
  })
  it('handles CRLF line endings', () => {
    const out = Papa.parse<string[]>('a,b\r\nc,d', { header: false })
    expect(out.data).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})

describe('parseSpliitCsv', () => {
  it.effect('rejects Spliit Cloud recurrence columns', () =>
    Effect.gen(function* () {
      const csv =
        '"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","Recurrence series ID","John ","Jane"\n' +
        '"2026-01-12","Rent","Rent","EUR","100.00",,,,"No","Evenly","series-1",50,-50'
      const error = yield* Effect.flip(parseSpliitCsv(csv))
      expect(error.message).toMatch(/CSV header is not a Spliit export/i)
    }),
  )

  it.effect('parses a representative CSV export', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitCsv(sampleCsv)
      expect(source.participants).toHaveLength(2)
      expect(source.participants[0].sourceName).toBe('John')
      expect(source.participants[1].sourceName).toBe('Jane')
      expect(source.sourceUrl).toBeNull()
      expect(source.expenses).toHaveLength(4)
      const first = source.expenses[0]
      expect(first.title).toBe('Kafe plazha')
      expect(first.amount).toBe(360)
      // 216 / 144 → GCD 72 → BY_SHARES; shares normalised to fixed units.
      expect(first.splitMode).toBe('BY_SHARES')
      expect(first.paidBySourceId).toBe(source.participants[1].sourceId)
      expect(first.paidFor).toEqual([
        { sourceId: source.participants[0].sourceId, shares: 300 },
        { sourceId: source.participants[1].sourceId, shares: 200 },
      ])
    }),
  )

  it.effect('rejects an unknown CSV header', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(parseSpliitCsv('a,b\nfoo,bar'))
      expect(error.message).toMatch(/CSV header is not a Spliit export/i)
    }),
  )

  it.effect('parses exports that include Conversion source', () =>
    Effect.gen(function* () {
      const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Conversion source","Is Reimbursement","Split mode","John ","Jane"
"2026-01-12","Dinner","Dining Out","EUR","10.00","9.00","USD","1.1","EXCHANGE","No","Evenly",5.00,-5.00`
      const source = yield* parseSpliitCsv(csv)
      expect(source.participants).toHaveLength(2)
      expect(source.expenses).toHaveLength(1)
      const expense = source.expenses[0]
      // Cost is ledger EUR 10.00; recover original USD minor units via rate
      expect(expense.amount).toBe(Math.round(1000 / 1.1))
      expect(expense.originalCurrency).toBe('USD')
      expect(expense.conversionRate).toBe(1.1)
      expect(expense.category).not.toBe('settlement')
    }),
  )

  it.effect('skips rows with unparseable amounts and returns no expenses', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        parseSpliitCsv(
          `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John "
"2025-01-01","Bad","General","EUR","abc",,,,"No","Evenly",1.00`,
        ),
      )
      expect(error.message).toMatch(/CSV had no parseable expenses/i)
    }),
  )

  it.effect('maps Is Reimbursement Yes onto settlement (legacy alias)', () =>
    Effect.gen(function* () {
      const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John ","Jane"
"2026-03-12","Reimbursement","Payment","EUR","51.92",,,,"Yes","Unevenly – By shares",0,-51.92`
      const source = yield* parseSpliitCsv(csv)
      expect(source.expenses[0].category).toBe('settlement')
      expect(source.expenses[0].amount).toBe(5192)
      expect(source.expenses[0].paidBySourceId).toBe(
        source.participants[0].sourceId,
      )
      expect(source.expenses[0].paidFor).toEqual([
        { sourceId: source.participants[1].sourceId, shares: 5192 },
      ])
    }),
  )

  it.effect(
    'keeps Payment without Is Reimbursement Yes as ordinary spend',
    () =>
      Effect.gen(function* () {
        const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John ","Jane"
"2026-01-31","Bank transfer","Payment","EUR","17.40",,,,"No","Evenly",10.44,-6.96`
        const source = yield* parseSpliitCsv(csv)
        expect(source.expenses[0].category).toBe('payment')
      }),
  )

  it.effect(
    'accepts the current Is Settlement CSV header as a settlement flag',
    () =>
      Effect.gen(function* () {
        const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Settlement","Split mode","John ","Jane"
"2026-01-31","Paid Jane","Settlement","EUR","17.40",,,,"Yes","Evenly",17.40,-17.40`
        const source = yield* parseSpliitCsv(csv)
        expect(source.expenses[0].category).toBe('settlement')
      }),
  )

  it.effect(
    'recovers original amount from Cost ÷ rate (ignores Original cost; upstream #513)',
    () =>
      Effect.gen(function* () {
        // Ledger Cost 1.23 USD; broken Original cost 0.01 BGN; rate 1 → recover 123 minor units.
        const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John ","Jane"
"2026-07-09","asdasd","General","USD","1.23","0.01","BGN","1","No","Evenly",0.82,0.41`
        const source = yield* parseSpliitCsv(csv)
        const exp = source.expenses[0]
        expect(exp.amount).toBe(123)
        expect(exp.originalAmount).toBe(123)
        expect(exp.amountCurrency).toBe('BGN')
        expect(exp.originalCurrency).toBe('BGN')
        expect(exp.conversionRate).toBe(1)
        expect(exp.paidBy[0].shares).toBe(123)
      }),
  )

  it.effect('maps category names to in-code category ids', () =>
    Effect.gen(function* () {
      const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John "
"2025-12-23","Gas","Gas/Fuel","EUR","70.00",,,,"No","Evenly",46.67`
      const source = yield* parseSpliitCsv(csv)
      expect(source.expenses[0].category).toBe('gas-fuel')
    }),
  )

  it.effect('strips a UTF-8 BOM if present', () =>
    Effect.gen(function* () {
      const withBom = '\ufeff' + sampleCsv
      const source = yield* parseSpliitCsv(withBom)
      expect(source.expenses).toHaveLength(4)
    }),
  )

  it.effect('handles a quoted Description field with an embedded comma', () =>
    Effect.gen(function* () {
      const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John ","Jane"
"2025-12-22","Leb, pekara","General","EUR","4.15",,,,"No","Evenly",-2.49,1.66`
      const source = yield* parseSpliitCsv(csv)
      expect(source.expenses[0].title).toBe('Leb, pekara')
    }),
  )

  it.effect(
    'handles Cyrillic and accented characters in titles and categories',
    () =>
      Effect.gen(function* () {
        const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John ","Jane"
"2026-01-31","Патарина","Payment","EUR","17.40",,,,"No","Evenly",10.44,-6.96
"2026-01-12","Café, plage","Dining Out","EUR","3.60",,,,"No","Evenly",-2.16,1.44`
        const source = yield* parseSpliitCsv(csv)
        expect(source.expenses).toHaveLength(2)
        expect(source.expenses[0].title).toBe('Патарина')
        expect(source.expenses[1].title).toBe('Café, plage')
      }),
  )

  it.effect(
    'skips expense rows where no payer is identified (all negative values)',
    () =>
      Effect.gen(function* () {
        const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John ","Jane"
"2026-01-12","Dinner","Dining Out","EUR","30.00",,,,"No","Evenly",-15.00,-15.00`
        const error = yield* Effect.flip(parseSpliitCsv(csv))
        expect(error.message).toMatch(/CSV had no parseable expenses/i)
      }),
  )

  it.effect(
    'treats the first zero-value participant as payer when all participant values are zero',
    () =>
      Effect.gen(function* () {
        // Zero-amount expense with no participants can't be imported: the
        // destination validator requires paidFor.shares > 0.
        const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John ","Jane"
"2026-01-12","Zero Split","General","EUR","0.00",,,,"No","Evenly",0.00,0.00`
        yield* Effect.flip(parseSpliitCsv(csv))
      }),
  )

  it.effect(
    'reconstructs paidFor from export nets (not abs of nets as shares)',
    () =>
      Effect.gen(function* () {
        // Export nets: paidBy − paidFor. $100 paid by John, owes $30 / Jane owes $70
        // → nets +70 / −70. Must NOT become 70/70 EVENLY.
        // guessSplitMode reduces 3000:7000 → BY_SHARES 3:7, then scales the
        // ratio to the internal fixed units (×100) so the resulting shares
        // are 300 and 700 (= 3.00 / 7.00 displayed).
        const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John ","Jane"
"2025-12-25","Uneven dinner","General","EUR","100.00",,,,"No","Unevenly – By amount",70.00,-70.00`
        const source = yield* parseSpliitCsv(csv)
        const e = source.expenses[0]
        const john = source.participants[0].sourceId
        const jane = source.participants[1].sourceId
        expect(e.amount).toBe(10000)
        expect(e.paidBySourceId).toBe(john)
        const byId = Object.fromEntries(
          e.paidFor.map((p) => [p.sourceId, p.shares]),
        )
        expect(byId[john]).toBe(300)
        expect(byId[jane]).toBe(700)
        expect(e.splitMode).toBe('BY_SHARES')
      }),
  )

  it.effect('reconstructs even-split nets to equal paidFor shares', () =>
    Effect.gen(function* () {
      // John paid $10.76, split evenly → nets +5.38 / −5.38
      const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John ","Jane"
"2025-12-25","Podaroci","General","EUR","10.76",,,,"No","Evenly",5.38,-5.38`
      const source = yield* parseSpliitCsv(csv)
      const e = source.expenses[0]
      expect(e.amount).toBe(1076)
      expect(e.splitMode).toBe('EVENLY')
      expect(e.paidFor.map((p) => p.shares).sort((a, b) => a - b)).toEqual([
        538, 538,
      ])
    }),
  )

  it.effect('reconstructs 3-participant single-payer nets', () =>
    Effect.gen(function* () {
      // Cost $100; John paid, owes $10; Jane $30; Bob $60 → nets +90,−30,−60
      // 1000:3000:6000 → BY_SHARES 1:3:6, then ×100 to fixed units.
      const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John ","Jane ","Bob"
"2025-12-25","Trip","General","EUR","100.00",,,,"No","Unevenly – By amount",90.00,-30.00,-60.00`
      const source = yield* parseSpliitCsv(csv)
      const e = source.expenses[0]
      const [john, jane, bob] = source.participants.map((p) => p.sourceId)
      const byId = Object.fromEntries(
        e.paidFor.map((p) => [p.sourceId, p.shares]),
      )
      expect(byId[john]).toBe(100)
      expect(byId[jane]).toBe(300)
      expect(byId[bob]).toBe(600)
      expect(e.splitMode).toBe('BY_SHARES')
    }),
  )

  it.effect('handles 0-decimal currency (JPY) without 100× inflation', () =>
    Effect.gen(function* () {
      // JPY has 0 decimal digits. 5000 ¥ should stay 5000 minor units.
      const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John "
"2026-03-15","Ramen","Dining Out","JPY","5000",,,,"No","Evenly",5000.00`
      const source = yield* parseSpliitCsv(csv)
      const e = source.expenses[0]
      expect(e.amount).toBe(5000)
      expect(e.paidFor[0].shares).toBe(5000)
    }),
  )
})

describe('recoverSpliitOriginalAmount decimal-digits scaling (folded from spliit-original-amount.test.ts)', () => {
  it('scales when ledger and original currencies have different decimal_digits', () => {
    // 15_000 JPY ledger at 150 JPY/USD → 10000 USD cents
    expect(
      recoverSpliitOriginalAmount(15_000, 150, {
        originalCurrency: 'USD',
        ledgerCurrency: 'JPY',
      }),
    ).toBe(10000)
  })
})
