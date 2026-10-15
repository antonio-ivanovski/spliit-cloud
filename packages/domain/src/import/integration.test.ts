import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { DEFAULT_CATEGORIES } from '../categories'
import { parseSpliitExport } from './spliit'
import { parseSpliitCsv } from './spliit-csv'
import { appendImportedFromNote } from './utils'

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
  it.effect(
    'parses the public Spliit Export sample into the expected shape',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSpliitExport(spliitExport)

        expect(source.sourceGroupId).toBe(spliitExport.id)
        expect(source.sourceUrl).toBe(
          `https://spliit.app/groups/${spliitExport.id}`,
        )
        expect(source.name).toBe(spliitExport.name)
        expect(source.currency).toBe(spliitExport.currency)
        expect(source.currencyCode).toBe(spliitExport.currencyCode ?? null)
        expect(source.participants).toHaveLength(
          spliitExport.participants.length,
        )
        expect(source.expenses).toHaveLength(spliitExport.expenses.length)
        expect(source.participants.map((p) => p.sourceId)).toEqual(
          spliitExport.participants.map(
            (_: unknown, i: number) => `spliit-participant-${i}`,
          ),
        )
      }),
  )

  it.effect('matches every source expense to a parsed expense', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitExport(spliitExport)
      const parsedIndex = new Set<string>()
      for (const e of source.expenses) {
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
    }),
  )

  it.effect(
    'preserves amount, paidBy, paidFor, splitMode, and category per expense',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSpliitExport(spliitExport)
        const parsedByKey = new Map<string, (typeof source.expenses)[number]>()
        for (const e of source.expenses) {
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
          expect(parsed.recurrenceRule).toBe(src.recurrenceRule ?? 'NONE')
          expect(parsed.splitMode).toBe(src.splitMode ?? 'EVENLY')

          expect(parsed.paidBySourceId).toBe(sourceIdForUpstream(src.paidById))

          const exp = expectedCategoryId(
            src.category?.grouping ?? '',
            src.category?.name ?? '',
          )
          const expectedId = src.isReimbursement ? 'settlement' : exp.id
          expect({
            id: parsed.category,
            matched: exp.matched,
          }).toEqual({ id: expectedId, matched: exp.matched })

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
            // BY_SHARES rows carry legacy whole-share counts from the
            // spliit.app export; the internal contract stores fixed units
            // (100 = 1 share), so multiply through. Other modes are the
            // literal source values (cents / basis points / even marker).
            const expectedShares =
              parsed.splitMode === 'BY_SHARES'
                ? srcRow.shares * 100
                : srcRow.shares
            expect(parsedRow.shares).toBe(expectedShares)
          }
        }
      }),
  )

  it.effect('category map has no unmapped categories', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitExport(spliitExport)
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
      expect(source.expenses.length).toBe(spliitExport.expenses.length)
    }),
  )
})

describe('CSV integration: Spliit CSV round-trips', () => {
  it.effect('parses the public Spliit Export sample', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitCsv(spliitCsv)
      expect(source.participants).toHaveLength(2)
      expect(source.participants.map((p) => p.sourceName)).toEqual([
        'John',
        'Jane',
      ])
      expect(source.participants.map((p) => p.sourceId)).toEqual([
        'csv-participant-0',
        'csv-participant-1',
      ])
      expect(source.expenses).toHaveLength(spliitExport.expenses.length)
    }),
  )

  it.effect('CSV amount equals JSON amount in cents for every expense', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitCsv(spliitCsv)

      const jsonByKey = new Map<string, number>()
      for (const e of spliitExport.expenses) {
        jsonByKey.set(
          keyOf(e.title, e.expenseDate?.slice(0, 10) ?? '', e.amount),
          e.amount,
        )
      }

      const drift: string[] = []
      for (const csvE of source.expenses) {
        const k = keyOf(csvE.title, csvE.expenseDate, csvE.amount)
        const jsonAmount = jsonByKey.get(k)
        if (jsonAmount === undefined) {
          expect(
            jsonAmount,
            `Missing JSON row for "${csvE.title}"`,
          ).toBeDefined()
          continue
        }
        if (Math.abs(csvE.amount - jsonAmount) > 1) {
          drift.push(
            `${csvE.title} (${csvE.expenseDate}): CSV=${csvE.amount} JSON=${jsonAmount}`,
          )
        }
      }
      expect(drift).toEqual([])
    }),
  )

  it.effect(
    'CSV paidFor totals round-trip within ±1 cent rounding tolerance',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSpliitCsv(spliitCsv)

        const drift: string[] = []
        for (const csvE of source.expenses) {
          // BY_SHARES / BY_PERCENTAGE carry ratio weights or basis points,
          // not cents, so their shares don't sum to the amount.
          if (
            csvE.splitMode === 'BY_SHARES' ||
            csvE.splitMode === 'BY_PERCENTAGE'
          )
            continue
          const sum = csvE.paidFor.reduce((s, p) => s + p.shares, 0)
          const diff = Math.abs(sum - csvE.amount)
          if (diff > 1) {
            drift.push(
              `${csvE.title}: sum=${sum} amount=${csvE.amount} diff=${diff}`,
            )
          }
        }
        expect(drift).toEqual([])
      }),
  )

  it.effect('CSV paidBy matches the JSON source for every expense', () =>
    Effect.gen(function* () {
      const source = yield* parseSpliitCsv(spliitCsv)

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
      for (const csvE of source.expenses) {
        const expectedPayer = jsonPayerByKey.get(
          keyOf(csvE.title, csvE.expenseDate, csvE.amount),
        )
        if (!expectedPayer) continue
        const actualPayer = source.participants.find(
          (p) => p.sourceId === csvE.paidBySourceId,
        )?.sourceName
        if (actualPayer !== expectedPayer) {
          mismatches.push(
            `"${csvE.title}" (${csvE.expenseDate}): CSV=${actualPayer} JSON=${expectedPayer}`,
          )
        }
      }
      expect(mismatches).toEqual([])
    }),
  )

  it.effect(
    'CSV category names resolve to the same in-code ids as JSON where possible',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSpliitCsv(spliitCsv)

        const mismatches: string[] = []
        for (const csvE of source.expenses) {
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
          const expectedId = jsonRow.isReimbursement ? 'settlement' : exp.id
          if (csvE.category !== expectedId) {
            mismatches.push(
              `"${csvE.title}" CSV=${csvE.category} JSON=${expectedId}`,
            )
          }
        }
        expect(mismatches).toEqual([])
      }),
  )

  it.effect(
    'every CSV paidFor amount is positive and is a valid cents integer',
    () =>
      Effect.gen(function* () {
        const source = yield* parseSpliitCsv(spliitCsv)
        for (const csvE of source.expenses) {
          for (const p of csvE.paidFor) {
            expect(
              p.shares,
              `${csvE.title}: share must be > 0`,
            ).toBeGreaterThan(0)
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
      }),
  )
})

describe('appendImportedFromNote (folded from utils.test.ts)', () => {
  it.each([
    [
      'joins an existing note with the source link on two newlines',
      () => {
        expect(
          appendImportedFromNote(
            'Group for the ski trip',
            'https://spliit.app/groups/abc',
          ),
        ).toBe(
          'Group for the ski trip\n\nImported from: https://spliit.app/groups/abc',
        )
      },
    ],
    [
      'uses only the source link when no existing note is provided',
      () => {
        expect(
          appendImportedFromNote(undefined, 'https://spliit.app/groups/abc'),
        ).toBe('Imported from: https://spliit.app/groups/abc')
        expect(
          appendImportedFromNote(null, 'https://spliit.app/groups/abc'),
        ).toBe('Imported from: https://spliit.app/groups/abc')
        expect(
          appendImportedFromNote('', 'https://spliit.app/groups/abc'),
        ).toBe('Imported from: https://spliit.app/groups/abc')
      },
    ],
    [
      'uses only the existing note when no source link is provided',
      () => {
        expect(appendImportedFromNote('Just a note', undefined)).toBe(
          'Just a note',
        )
        expect(appendImportedFromNote('Just a note', null)).toBe('Just a note')
        expect(appendImportedFromNote('Just a note', '')).toBe('Just a note')
      },
    ],
    [
      'returns undefined when neither is provided',
      () => {
        expect(appendImportedFromNote(undefined, undefined)).toBeUndefined()
        expect(appendImportedFromNote(null, null)).toBeUndefined()
        expect(appendImportedFromNote('', '')).toBeUndefined()
      },
    ],
    [
      'trims whitespace before deciding which branch to take',
      () => {
        expect(
          appendImportedFromNote('  ', 'https://spliit.app/groups/abc'),
        ).toBe('Imported from: https://spliit.app/groups/abc')
        expect(appendImportedFromNote('Group note', '  ')).toBe('Group note')
      },
    ],
  ] as Array<[string, () => void]>)('%s', (_title, run) => {
    run()
  })
})
