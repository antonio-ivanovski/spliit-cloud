import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { anonymizeSplitwiseCsv } from './anonymize-splitwise-csv'
import { tryParseSplitwiseCsv } from './splitwise-csv'

const HEADER = 'Date,Description,Category,Cost,Currency,John Doe,Jane Doe'

function buildSplitwiseCsv(rows: Array<Array<string>>): string {
  return [
    HEADER,
    ...rows.map((r) =>
      r.map((c) => (c.includes(',') ? `"${c}"` : c)).join(','),
    ),
  ].join('\n')
}

function readFixture(name: string): string {
  return readFileSync(join(__dirname, '../fixtures', name), 'utf-8')
}

/** Asserts the anonymizer produced a structurally valid Splitwise CSV
 *  that the importer can still parse, with no leakage of any original
 *  participant name. */
function assertAnonymized(input: string) {
  const originalParsed = tryParseSplitwiseCsv(input)
  expect(originalParsed.ok).toBe(true)
  if (!originalParsed.ok)
    throw new Error('fixture is not a valid Splitwise export')
  const originalParticipantNames = originalParsed.source.participants
    .map((p) => p.sourceName)
    .filter((n) => n.toLowerCase() !== 'total')

  const result = anonymizeSplitwiseCsv(input)

  // Output filename is a constant so it never leaks the input file's name.
  expect(result.outputName).toBe('splitwise-anonymized.csv')

  // Re-parsing the output should still succeed.
  const reparsed = tryParseSplitwiseCsv(result.outputCsv)
  expect(reparsed.ok).toBe(true)
  if (!reparsed.ok) return

  // Numeric diagnostic data is unchanged: row count + total amount.
  expect(reparsed.source.expenses).toHaveLength(
    originalParsed.source.expenses.length,
  )
  const originalTotal = originalParsed.source.expenses.reduce(
    (s, e) => s + e.amount,
    0,
  )
  const reprocessedTotal = reparsed.source.expenses.reduce(
    (s, e) => s + e.amount,
    0,
  )
  expect(reprocessedTotal).toBe(originalTotal)

  // Find the actual header line by content (preamble may precede it).
  const header = result.outputCsv
    .split('\n')
    .find((l) => l.startsWith('Date,Description,Category,Cost,Currency'))
  expect(header).toBeDefined()
  for (const name of originalParticipantNames) {
    expect(header!.toLowerCase()).not.toContain(name.toLowerCase())
    expect(header).toMatch(/Person \d+/)
  }
  for (const e of reparsed.source.expenses) {
    expect(e.title).toMatch(/^Expense \d+$/)
  }

  // No original participant name appears anywhere in the output CSV
  // (covers the body too — descriptions of payment rows could embed
  // names like "X paid Y" if such a row existed, though fixtures here
  // don't exercise that path).
  for (const name of originalParticipantNames) {
    expect(result.outputCsv.toLowerCase()).not.toContain(name.toLowerCase())
  }
}

describe('anonymizeSplitwiseCsv', () => {
  it('smoke: replaces names and descriptions on a tiny inline CSV', () => {
    const csv = buildSplitwiseCsv([
      ['2026-01-15', 'Dinner', 'Food', '40.00', 'USD', '40.00', '-40.00'],
    ])
    const result = anonymizeSplitwiseCsv(csv)
    expect(result.outputName).toBe('splitwise-anonymized.csv')
    const rows = result.outputCsv.split('\n')
    expect(rows[0]).toContain('Person 1')
    expect(rows[0]).toContain('Person 2')
    expect(rows[0]).not.toContain('John Doe')
    expect(rows[0]).not.toContain('Jane Doe')
    expect(rows[1]).toContain('Expense 1')
    expect(rows[1]).not.toContain('Dinner')
    expect(rows[1]).toContain('40.00')
  })

  it('anonymizes the canonical group export fixture', () => {
    assertAnonymized(readFixture('_2026-06-30_export.csv'))
  })

  it('anonymizes the personal export fixture (preamble + 600+ rows)', () => {
    assertAnonymized(
      readFixture('john-i-and-jane-i_2026-06-30_export copy.csv'),
    )
  })

  it('anonymizes the multi-payer fixture (mixed currencies + balance rows)', () => {
    assertAnonymized(readFixture('splitwise-multi-payer.csv'))
  })
})
