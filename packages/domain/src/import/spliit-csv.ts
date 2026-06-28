import Papa from 'papaparse'
import { DEFAULT_CATEGORIES } from '../categories'
import type { ImportParseResult, NormalizedSource } from './types'

const PARTICIPANT_START_INDEX = 10

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isNaN(n) ? null : n
}

export function tryParseSpliitCsv(input: string): ImportParseResult {
  const cleaned = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const parsed = Papa.parse<string[]>(cleaned, {
    skipEmptyLines: 'greedy',
    header: false,
  })

  const rows = parsed.data
  if (rows.length < 2) {
    return { ok: false, error: 'CSV has no data rows' }
  }
  if (parsed.errors.length > 0) {
    return {
      ok: false,
      error: `CSV could not be parsed: ${parsed.errors[0]?.message ?? 'unknown error'}`,
    }
  }
  const header = rows[0]
  if (!validateHeader(header)) {
    return { ok: false, error: 'CSV header is not a Spliit export' }
  }

  const participantHeaders = header
    .slice(PARTICIPANT_START_INDEX)
    .map((h: string) => h.trim())
    .filter((h: string) => h.length > 0)

  if (participantHeaders.length === 0) {
    return { ok: false, error: 'CSV is missing participant columns' }
  }

  const participantIndex = new Map<string, number>()
  const participants: NormalizedSource['participants'] = []
  for (const name of participantHeaders) {
    const key = name.toLowerCase()
    if (participantIndex.has(key)) continue
    const idx = participants.length
    participantIndex.set(key, idx)
    participants.push({
      sourceId: `csv-participant-${idx}`,
      sourceName: name,
    })
  }

  const expenses: NormalizedSource['expenses'] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.every((c: string) => (c ?? '').trim() === '')) continue
    const date = (row[0] ?? '').trim()
    const title = (row[1] ?? '').trim()
    const category = (row[2] ?? '').trim()
    const costMajor = toNumberOrNull(row[4])
    const isReimbursement = (row[8] ?? '').trim().toLowerCase() === 'yes'

    if (!/^\d{4}-\d{2}-\d{2}/.test(date)) continue
    if (title.length === 0) continue
    if (costMajor === null) continue
    const amountCents = Math.round(costMajor * 100)

    let paidBySourceId: string | null = null
    const perParticipantCents: Array<{ sourceId: string; cents: number }> = []
    let bestAbs = Infinity
    let bestAbsSourceId: string | null = null
    for (let i = PARTICIPANT_START_INDEX; i < header.length; i++) {
      const name = (header[i] ?? '').trim()
      if (!name) continue
      const raw = toNumberOrNull(row[i])
      if (raw === null) continue
      const idx = participantIndex.get(name.toLowerCase())
      if (idx === undefined) continue
      const sourceId = participants[idx].sourceId
      const cents = Math.round(Math.abs(raw) * 100)
      if (cents > 0) {
        perParticipantCents.push({ sourceId, cents })
      }
      if (raw > 0) {
        paidBySourceId = sourceId
      } else if (raw === 0) {
        if (bestAbs > 0) {
          bestAbs = 0
          bestAbsSourceId = sourceId
        }
      }
    }
    if (!paidBySourceId) {
      paidBySourceId = bestAbsSourceId
    }
    if (!paidBySourceId) continue

    const sumShares = perParticipantCents.reduce((s, p) => s + p.cents, 0)
    const drift = sumShares - amountCents
    if (drift !== 0 && perParticipantCents.length > 0) {
      let largestIdx = 0
      for (let i = 1; i < perParticipantCents.length; i++) {
        if (
          perParticipantCents[i].cents > perParticipantCents[largestIdx].cents
        ) {
          largestIdx = i
        }
      }
      perParticipantCents[largestIdx].cents -= drift
    }

    expenses.push({
      title,
      expenseDate: date.slice(0, 10),
      category: categoryToId(category),
      amount: amountCents,
      originalAmount:
        toNumberOrNull(row[5]) !== null
          ? Math.round((toNumberOrNull(row[5]) ?? 0) * 100)
          : null,
      originalCurrency:
        (row[6] ?? '').trim().length === 3 ? (row[6] ?? '').trim() : null,
      conversionRate: toNumberOrNull(row[7]),
      paidBySourceId,
      paidFor: perParticipantCents.map((p) => ({
        sourceId: p.sourceId,
        shares: p.cents,
      })),
      splitMode: 'BY_AMOUNT',
      recurrenceRule: 'NONE',
      isReimbursement,
      notes: null,
    })
  }

  if (expenses.length === 0) {
    return { ok: false, error: 'CSV had no parseable expenses' }
  }

  return {
    ok: true,
    source: {
      sourceGroupId: 'csv-import',
      sourceUrl: null,
      name: 'Imported from CSV',
      currency: '€',
      currencyCode: null,
      participants,
      expenses,
    },
  }
}

function validateHeader(header: string[]): boolean {
  return (
    header[0] === 'Date' &&
    header[1] === 'Description' &&
    header[2] === 'Category' &&
    header[3] === 'Currency' &&
    header[4] === 'Cost' &&
    header[5] === 'Original cost' &&
    header[6] === 'Original currency' &&
    header[7] === 'Conversion rate' &&
    header[8] === 'Is Reimbursement' &&
    header[9] === 'Split mode'
  )
}

function categoryToId(name: string): string {
  if (!name) return 'general'
  const key = name.toLowerCase()
  const match = DEFAULT_CATEGORIES.find((c) => c.name.toLowerCase() === key)
  return match?.id ?? 'general'
}
