import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../categories'
import { parseSpliitExport, tryParseSpliitExport } from './spliit'
import { tryParseSpliitCsv } from './spliit-csv'

const here = dirname(fileURLToPath(import.meta.url))
const jsonFixturePath = resolve(here, '../fixtures/spliit-export.json')
const csvFixturePath = resolve(here, '../fixtures/spliit-export.csv')

const spliitExport = JSON.parse(readFileSync(jsonFixturePath, 'utf8'))
const spliitCsv = readFileSync(csvFixturePath, 'utf8')

function expectedCategoryId(
  grouping: string,
  name: string,
): { id: string; matched: 'exact' | 'name-only' | 'fallback' } {
  const exact = DEFAULT_CATEGORIES.find(
    (c) =>
      c.grouping.toLowerCase() === grouping.toLowerCase() &&
      c.name.toLowerCase() === name.toLowerCase(),
  )
  if (exact) return { id: exact.id, matched: 'exact' }
  const partial = DEFAULT_CATEGORIES.find(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  )
  if (partial) return { id: partial.id, matched: 'name-only' }
  return { id: 'general', matched: 'fallback' }
}

function keyOf(title: string, date: string, amount: number): string {
  return `${title.trim()}|${date}|${amount}`
}

function sourceIdForUpstream(upstreamId: string): string {
  const idx = spliitExport.participants.findIndex(
    (p: { id: string }) => p.id === upstreamId,
  )
  if (idx < 0) throw new Error(`Unknown upstream participant ${upstreamId}`)
  return `spliit-participant-${idx}`
}

describe('JSON integration: Spliit export round-trips', () => {
  it('parses the public Spliit Export sample into the expected shape', () => {
    const result = tryParseSpliitExport(spliitExport)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.source.sourceGroupId).toBe(spliitExport.id)
    expect(result.source.sourceUrl).toBe(
      `https://spliit.app/groups/${spliitExport.id}`,
    )
    expect(result.source.name).toBe(spliitExport.name)
    expect(result.source.currency).toBe(spliitExport.currency)
    expect(result.source.currencyCode).toBe(spliitExport.currencyCode ?? null)
    expect(result.source.participants).toHaveLength(
      spliitExport.participants.length,
    )
    expect(result.source.expenses).toHaveLength(spliitExport.expenses.length)
    expect(result.source.participants.map((p) => p.sourceId)).toEqual(
      spliitExport.participants.map(
        (_: unknown, i: number) => `spliit-participant-${i}`,
      ),
    )
  })

  it('matches every source expense to a parsed expense', () => {
    const result = parseSpliitExport(spliitExport)
    const parsedIndex = new Set<string>()
    for (const e of result.expenses) {
      parsedIndex.add(keyOf(e.title, e.expenseDate, e.amount))
    }

    let missingCount = 0
    for (const src of spliitExport.expenses) {
      const key = keyOf(
        src.title,
        src.expenseDate?.slice(0, 10) ?? '',
        src.amount,
      )
      if (!parsedIndex.has(key)) missingCount++
    }
    expect(missingCount).toBe(0)
  })

  it('preserves amount, paidBy, paidFor, splitMode, and category per expense', () => {
    const result = parseSpliitExport(spliitExport)
    const parsedByKey = new Map<string, (typeof result.expenses)[number]>()
    for (const e of result.expenses) {
      parsedByKey.set(keyOf(e.title, e.expenseDate, e.amount), e)
    }

    for (const src of spliitExport.expenses) {
      const key = keyOf(
        src.title,
        src.expenseDate?.slice(0, 10) ?? '',
        src.amount,
      )
      const parsed = parsedByKey.get(key)
      expect(
        parsed,
        `Missing parsed expense for "${src.title}" (${src.amount})`,
      ).toBeDefined()
      if (!parsed) continue

      expect(parsed.amount).toBe(src.amount)
      expect(parsed.isReimbursement).toBe(src.isReimbursement)
      expect(parsed.recurrenceRule).toBe(src.recurrenceRule ?? 'NONE')
      expect(parsed.splitMode).toBe(src.splitMode ?? 'EVENLY')

      expect(parsed.paidBySourceId).toBe(sourceIdForUpstream(src.paidById))

      const exp = expectedCategoryId(
        src.category?.grouping ?? '',
        src.category?.name ?? '',
      )
      expect({
        id: parsed.category,
        matched: exp.matched,
      }).toEqual({ id: exp.id, matched: exp.matched })

      expect(parsed.paidFor).toHaveLength(src.paidFor.length)
      for (const srcRow of src.paidFor) {
        const expectedSourceId = sourceIdForUpstream(srcRow.participantId)
        const parsedRow = parsed.paidFor.find(
          (p: { sourceId: string }) => p.sourceId === expectedSourceId,
        )
        expect(
          parsedRow,
          `Missing paidFor row for ${srcRow.participantId}`,
        ).toBeDefined()
        if (!parsedRow) continue
        expect(parsedRow.shares).toBe(srcRow.shares)
      }
    }
  })

  it('category map has no unmapped categories', () => {
    const result = parseSpliitExport(spliitExport)
    const unmapped: string[] = []
    for (const src of spliitExport.expenses) {
      const exp = expectedCategoryId(
        src.category?.grouping ?? '',
        src.category?.name ?? '',
      )
      if (exp.matched === 'fallback') {
        unmapped.push(`${src.category?.grouping}/${src.category?.name}`)
      }
    }
    expect(unmapped).toEqual([])
    expect(result.expenses.length).toBe(spliitExport.expenses.length)
  })
})

describe('CSV integration: Spliit CSV round-trips', () => {
  it('parses the public Spliit Export sample', () => {
    const result = tryParseSpliitCsv(spliitCsv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.participants).toHaveLength(2)
    expect(result.source.participants.map((p) => p.sourceName)).toEqual([
      'John',
      'Jane',
    ])
    expect(result.source.participants.map((p) => p.sourceId)).toEqual([
      'csv-participant-0',
      'csv-participant-1',
    ])
    expect(result.source.expenses).toHaveLength(spliitExport.expenses.length)
  })

  it('CSV amount equals JSON amount in cents for every expense', () => {
    const result = tryParseSpliitCsv(spliitCsv)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const jsonByKey = new Map<string, number>()
    for (const e of spliitExport.expenses) {
      jsonByKey.set(
        keyOf(e.title, e.expenseDate?.slice(0, 10) ?? '', e.amount),
        e.amount,
      )
    }

    const drift: string[] = []
    for (const csvE of result.source.expenses) {
      const k = keyOf(csvE.title, csvE.expenseDate, csvE.amount)
      const jsonAmount = jsonByKey.get(k)
      if (jsonAmount === undefined) {
        expect(jsonAmount, `Missing JSON row for "${csvE.title}"`).toBeDefined()
        continue
      }
      if (Math.abs(csvE.amount - jsonAmount) > 1) {
        drift.push(
          `${csvE.title} (${csvE.expenseDate}): CSV=${csvE.amount} JSON=${jsonAmount}`,
        )
      }
    }
    expect(drift).toEqual([])
  })

  it('CSV paidFor totals round-trip within ±1 cent rounding tolerance', () => {
    const result = tryParseSpliitCsv(spliitCsv)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const drift: string[] = []
    for (const csvE of result.source.expenses) {
      const sum = csvE.paidFor.reduce((s, p) => s + p.shares, 0)
      const diff = Math.abs(sum - csvE.amount)
      if (diff > 1) {
        drift.push(
          `${csvE.title}: sum=${sum} amount=${csvE.amount} diff=${diff}`,
        )
      }
    }
    expect(drift).toEqual([])
  })

  it('CSV paidBy matches the JSON source for every expense', () => {
    const result = tryParseSpliitCsv(spliitCsv)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const jsonNamesById = new Map<string, string>()
    for (const p of spliitExport.participants) {
      jsonNamesById.set(p.id, p.name.trim())
    }
    const jsonPayerByKey = new Map<string, string>()
    for (const e of spliitExport.expenses) {
      const payerName = jsonNamesById.get(e.paidById) ?? null
      if (payerName) {
        jsonPayerByKey.set(
          keyOf(e.title, e.expenseDate?.slice(0, 10) ?? '', e.amount),
          payerName,
        )
      }
    }

    const mismatches: string[] = []
    for (const csvE of result.source.expenses) {
      const expectedPayer = jsonPayerByKey.get(
        keyOf(csvE.title, csvE.expenseDate, csvE.amount),
      )
      if (!expectedPayer) continue
      const actualPayer = result.source.participants.find(
        (p) => p.sourceId === csvE.paidBySourceId,
      )?.sourceName
      if (actualPayer !== expectedPayer) {
        mismatches.push(
          `"${csvE.title}" (${csvE.expenseDate}): CSV=${actualPayer} JSON=${expectedPayer}`,
        )
      }
    }
    expect(mismatches).toEqual([])
  })

  it('CSV category names resolve to the same in-code ids as JSON where possible', () => {
    const result = tryParseSpliitCsv(spliitCsv)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const mismatches: string[] = []
    for (const csvE of result.source.expenses) {
      const jsonRow = spliitExport.expenses.find(
        (e: (typeof spliitExport.expenses)[number]) =>
          e.title === csvE.title &&
          e.expenseDate?.slice(0, 10) === csvE.expenseDate,
      )
      if (!jsonRow) continue
      const exp = expectedCategoryId(
        jsonRow.category?.grouping ?? '',
        jsonRow.category?.name ?? '',
      )
      if (exp.matched !== 'exact' && exp.matched !== 'name-only') continue
      if (csvE.category !== exp.id) {
        mismatches.push(`"${csvE.title}" CSV=${csvE.category} JSON=${exp.id}`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('every CSV paidFor amount is positive and is a valid cents integer', () => {
    const result = tryParseSpliitCsv(spliitCsv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const csvE of result.source.expenses) {
      for (const p of csvE.paidFor) {
        expect(p.shares, `${csvE.title}: share must be > 0`).toBeGreaterThan(0)
        expect(
          Number.isInteger(p.shares),
          `${csvE.title}: share must be an integer`,
        ).toBe(true)
      }
      expect(
        csvE.paidBySourceId,
        `${csvE.title}: must have a payer`,
      ).toBeTruthy()
    }
  })
})

function extractCell(row: string, index: number): string {
  const cells: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]
    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      cells.push(cell)
      cell = ''
      continue
    }
    cell += ch
  }
  cells.push(cell)
  return cells[index] ?? ''
}
