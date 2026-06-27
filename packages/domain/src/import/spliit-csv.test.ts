import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import { tryParseSpliitCsv } from './spliit-csv'

const sampleCsv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","Antonio ","Bela"
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

describe('tryParseSpliitCsv', () => {
  it('parses a representative CSV export', () => {
    const result = tryParseSpliitCsv(sampleCsv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.participants).toHaveLength(2)
    expect(result.source.participants[0].sourceName).toBe('Antonio')
    expect(result.source.participants[1].sourceName).toBe('Bela')
    expect(result.source.sourceUrl).toBeNull()
    expect(result.source.expenses).toHaveLength(4)
    const first = result.source.expenses[0]
    expect(first.title).toBe('Kafe plazha')
    expect(first.amount).toBe(360)
    expect(first.splitMode).toBe('BY_AMOUNT')
    expect(first.paidBySourceId).toBe(result.source.participants[1].sourceId)
    expect(first.paidFor).toEqual([
      { sourceId: result.source.participants[0].sourceId, shares: 216 },
      { sourceId: result.source.participants[1].sourceId, shares: 144 },
    ])
  })

  it('rejects an unknown CSV header', () => {
    const result = tryParseSpliitCsv('a,b\nfoo,bar')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/CSV header is not a Spliit export/i)
  })

  it('skips rows with unparseable amounts and returns no expenses', () => {
    const result = tryParseSpliitCsv(
      `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","Antonio "
"2025-01-01","Bad","General","EUR","abc",,,,"No","Evenly",1.00`,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/CSV had no parseable expenses/i)
  })

  it('marks reimbursement expenses as such', () => {
    const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","Antonio ","Bela"
"2026-03-12","Reimbursement","Payment","EUR","51.92",,,,"Yes","Unevenly – By shares",0,-51.92`
    const result = tryParseSpliitCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses[0].isReimbursement).toBe(true)
    expect(result.source.expenses[0].amount).toBe(5192)
    expect(result.source.expenses[0].paidBySourceId).toBe(
      result.source.participants[0].sourceId,
    )
    expect(result.source.expenses[0].paidFor).toEqual([
      { sourceId: result.source.participants[1].sourceId, shares: 5192 },
    ])
  })

  it('maps category names to in-code category ids', () => {
    const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","Antonio "
"2025-12-23","Gas","Gas/Fuel","EUR","70.00",,,,"No","Evenly",46.67`
    const result = tryParseSpliitCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses[0].category).toBe('gas-fuel')
  })

  it('strips a UTF-8 BOM if present', () => {
    const withBom = '\ufeff' + sampleCsv
    const result = tryParseSpliitCsv(withBom)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses).toHaveLength(4)
  })

  it('handles a quoted Description field with an embedded comma', () => {
    const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","Antonio ","Bela"
"2025-12-22","Leb, pekara","General","EUR","4.15",,,,"No","Evenly",-2.49,1.66`
    const result = tryParseSpliitCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses[0].title).toBe('Leb, pekara')
  })

  it('handles Cyrillic and accented characters in titles and categories', () => {
    const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","Antonio ","Bela"
"2026-01-31","Патарина","Payment","EUR","17.40",,,,"No","Evenly",10.44,-6.96
"2026-01-12","Café, plage","Dining Out","EUR","3.60",,,,"No","Evenly",-2.16,1.44`
    const result = tryParseSpliitCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses).toHaveLength(2)
    expect(result.source.expenses[0].title).toBe('Патарина')
    expect(result.source.expenses[1].title).toBe('Café, plage')
  })

  it('absorbs per-row rounding drift so the paidFor sum equals the amount (BY_AMOUNT)', () => {
    const csv = `"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","Antonio ","Bela"
"2025-12-25","Podaroci","General","EUR","10.75",,,,"No","Evenly",5.38,5.38`
    const result = tryParseSpliitCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const e = result.source.expenses[0]
    expect(e.amount).toBe(1075)
    const sum = e.paidFor.reduce((s, p) => s + p.shares, 0)
    expect(sum).toBe(1075)
    expect(e.paidFor).toEqual([
      { sourceId: e.paidFor[0].sourceId, shares: 537 },
      { sourceId: e.paidFor[1].sourceId, shares: 538 },
    ])
  })
})
