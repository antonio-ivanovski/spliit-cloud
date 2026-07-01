import Papa from 'papaparse'
import { DEFAULT_CATEGORIES } from '../categories'
import { getCurrency } from '../currency'
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
  const currencyCounts = new Map<string, number>()
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.every((c: string) => (c ?? '').trim() === '')) continue
    const date = (row[0] ?? '').trim()
    const title = (row[1] ?? '').trim()
    const category = (row[2] ?? '').trim()
    const rowCurrency = (row[3] ?? '').trim().toUpperCase()
    const costMajor = toNumberOrNull(row[4])
    const isReimbursement = (row[8] ?? '').trim().toLowerCase() === 'yes'

    if (!/^\d{4}-\d{2}-\d{2}/.test(date)) continue
    if (title.length === 0) continue
    if (costMajor === null) continue
    const amountCents = Math.round(costMajor * 100)

    if (rowCurrency.length === 3) {
      currencyCounts.set(
        rowCurrency,
        (currencyCounts.get(rowCurrency) ?? 0) + 1,
      )
    }

    type Entry = { sourceId: string; raw: number; cents: number }
    const entries: Entry[] = []
    let paidBySourceId: string | null = null
    let firstZeroSourceId: string | null = null
    for (let i = PARTICIPANT_START_INDEX; i < header.length; i++) {
      const name = (header[i] ?? '').trim()
      if (!name) continue
      const raw = toNumberOrNull(row[i])
      if (raw === null) continue
      const idx = participantIndex.get(name.toLowerCase())
      if (idx === undefined) continue
      const sourceId = participants[idx].sourceId
      if (raw > 0 && !paidBySourceId) {
        paidBySourceId = sourceId
      } else if (raw === 0 && !firstZeroSourceId) {
        firstZeroSourceId = sourceId
      }
      if (raw !== 0) {
        entries.push({
          sourceId,
          raw,
          cents: Math.round(Math.abs(raw) * 100),
        })
      }
    }
    if (!paidBySourceId) paidBySourceId = firstZeroSourceId
    if (!paidBySourceId) continue

    let paidFor: Array<{ sourceId: string; shares: number }>

    if (isReimbursement) {
      // Spliit encodes the receiver as the negative-value participant.
      // If the receiver isn't explicit (old-style), pick the first
      // non-payer participant so paidFor has a single entry.
      const receiver = entries.find((e) => e.raw < 0)
      if (receiver) {
        const payer = entries.find((e) => e.raw > 0)
        if (payer) paidBySourceId = payer.sourceId
        paidFor = [{ sourceId: receiver.sourceId, shares: amountCents }]
      } else {
        const other = entries.find((e) => e.sourceId !== paidBySourceId)
        if (other) {
          paidFor = [{ sourceId: other.sourceId, shares: amountCents }]
        } else {
          paidFor = [{ sourceId: paidBySourceId, shares: amountCents }]
        }
      }
    } else {
      const shares: Array<{ sourceId: string; cents: number }> = entries.map(
        (e) => ({ sourceId: e.sourceId, cents: e.cents }),
      )
      const sumShares = shares.reduce((s, p) => s + p.cents, 0)
      const drift = sumShares - amountCents
      if (drift !== 0 && shares.length > 0) {
        let largestIdx = 0
        for (let i = 1; i < shares.length; i++) {
          if (shares[i].cents > shares[largestIdx].cents) largestIdx = i
        }
        shares[largestIdx].cents -= drift
      }
      paidFor = shares
        .filter((p) => p.cents > 0)
        .map((p) => ({ sourceId: p.sourceId, shares: p.cents }))
    }

    if (paidFor.length === 0) continue

    const originalCost = toNumberOrNull(row[5])
    const originalCurrencyRaw = (row[6] ?? '').trim()
    const hasOriginalCurrency = originalCurrencyRaw.length === 3
    const conversionRate = toNumberOrNull(row[7])
    const hasPriorConversion =
      hasOriginalCurrency && originalCost !== null && conversionRate !== null
    expenses.push({
      title,
      expenseDate: date.slice(0, 10),
      category: categoryToId(category),
      amountCurrency: rowCurrency.length === 3 ? rowCurrency : null,
      amount: amountCents,
      originalAmount: hasPriorConversion
        ? Math.round(originalCost * 100)
        : null,
      originalCurrency: hasPriorConversion ? originalCurrencyRaw : null,
      conversionRate: hasPriorConversion ? conversionRate : null,
      paidBySourceId,
      paidBy: [
        {
          sourceId: paidBySourceId,
          shares: hasPriorConversion
            ? Math.round(originalCost * 100)
            : amountCents,
        },
      ],
      paidFor,
      splitMode: 'BY_AMOUNT',
      recurrenceRule: 'NONE',
      isReimbursement,
      notes: null,
    })
  }

  if (expenses.length === 0) {
    return { ok: false, error: 'CSV had no parseable expenses' }
  }

  let mostCommonCurrency: string | null = null
  let maxCount = 0
  for (const [code, count] of currencyCounts) {
    if (count > maxCount) {
      maxCount = count
      mostCommonCurrency = code
    }
  }

  const currency = mostCommonCurrency
    ? (getCurrency(mostCommonCurrency)?.symbol ?? mostCommonCurrency)
    : ''

  return {
    ok: true,
    source: {
      provider: 'SPLIIT',
      sourceGroupId: 'csv-import',
      sourceUrl: null,
      name: 'Imported from CSV',
      currency,
      currencyCode: mostCommonCurrency,
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
