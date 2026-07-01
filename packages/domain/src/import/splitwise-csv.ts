import Papa from 'papaparse'
import { splitwiseCategoryToId } from './splitwise-categories'
import type { ImportParseResult, NormalizedSource } from './types'

const PARTICIPANT_START_INDEX = 5

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isNaN(n) ? null : n
}

export function tryParseSplitwiseCsv(input: string): ImportParseResult {
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

  let headerRowIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (
      row[0] === 'Date' &&
      row[1] === 'Description' &&
      row[2] === 'Category' &&
      row[3] === 'Cost' &&
      row[4] === 'Currency'
    ) {
      headerRowIdx = i
      break
    }
  }
  if (headerRowIdx === -1) {
    return { ok: false, error: 'CSV header is not a Splitwise export' }
  }
  const header = rows[headerRowIdx]

  const participantIndex = new Map<string, number>()
  const participants: NormalizedSource['participants'] = []
  for (let i = PARTICIPANT_START_INDEX; i < header.length; i++) {
    const name = (header[i] ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (participantIndex.has(key)) continue
    const idx = participants.length
    participantIndex.set(key, idx)
    participants.push({
      sourceId: `splitwise-participant-${idx}`,
      sourceName: name,
    })
  }
  if (participants.length === 0) {
    return { ok: false, error: 'CSV is missing participant columns' }
  }

  const expenses: NormalizedSource['expenses'] = []
  const currencyCounts = new Map<string, number>()
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.every((c: string) => (c ?? '').trim() === '')) continue
    const date = (row[0] ?? '').trim()
    const title = (row[1] ?? '').trim()
    const category = (row[2] ?? '').trim()
    const cost = toNumberOrNull(row[3])
    const currency = (row[4] ?? '').trim().toUpperCase()
    if (!/^\d{4}-\d{2}-\d{2}/.test(date)) continue
    if (!title) continue
    if (cost === null) continue
    if (currency.length !== 3) continue
    if (title.toLowerCase() === 'total balance') continue

    currencyCounts.set(currency, (currencyCounts.get(currency) ?? 0) + 1)

    const isReimbursement =
      category.toLowerCase() === 'payment' || /^.+ paid .+ /.test(title)

    // Per Splitwise convention each cell is `Paid - Owe`.
    let payerSourceId: string | null = null
    let maxRaw = -Infinity
    const entries: Array<{ sourceId: string; raw: number; cents: number }> = []
    for (let i = PARTICIPANT_START_INDEX; i < header.length; i++) {
      const name = (header[i] ?? '').trim()
      if (!name) continue
      const raw = toNumberOrNull(row[i])
      if (raw === null) continue
      const idx = participantIndex.get(name.toLowerCase())
      if (idx === undefined) continue
      const sourceId = participants[idx].sourceId
      if (raw !== 0) {
        entries.push({ sourceId, raw, cents: Math.round(Math.abs(raw) * 100) })
      }
      if (raw > maxRaw) {
        maxRaw = raw
        payerSourceId = sourceId
      }
    }
    if (entries.length === 0 || maxRaw <= 0 || !payerSourceId) continue

    const amountCents = Math.round(cost * 100)
    const positiveEntries = entries.filter((e) => e.raw > 0)
    const negativeEntries = entries.filter((e) => e.raw < 0)
    const paidFor: Array<{ sourceId: string; shares: number }> = []
    let negativeTotal = 0
    for (const e of negativeEntries) {
      paidFor.push({ sourceId: e.sourceId, shares: e.cents })
      negativeTotal += e.cents
    }
    const remainingShare = amountCents - negativeTotal
    const positiveShares = positiveEntries.map((e) => ({
      sourceId: e.sourceId,
      shares: Math.max(0, Math.floor(remainingShare / positiveEntries.length)),
    }))
    let allocatedPositiveShares = positiveShares.reduce(
      (sum, p) => sum + p.shares,
      0,
    )
    for (
      let i = 0;
      allocatedPositiveShares < remainingShare && i < positiveShares.length;
      i++
    ) {
      positiveShares[i].shares += 1
      allocatedPositiveShares += 1
    }
    for (const p of positiveShares) {
      if (p.shares > 0) paidFor.push(p)
    }
    if (paidFor.length === 0) continue

    const paidBy = positiveEntries.map((e) => {
      const consumed =
        positiveShares.find((p) => p.sourceId === e.sourceId)?.shares ?? 0
      return { sourceId: e.sourceId, shares: e.cents + consumed }
    })
    const paidTotal = paidBy.reduce((sum, p) => sum + p.shares, 0)
    const paidDrift = amountCents - paidTotal
    if (paidDrift !== 0 && paidBy.length > 0) {
      let largestIdx = 0
      for (let i = 1; i < paidBy.length; i++) {
        if (paidBy[i].shares > paidBy[largestIdx].shares) largestIdx = i
      }
      paidBy[largestIdx].shares += paidDrift
    }

    // Equal split when at least two participants consume the same amount.
    let splitMode: 'EVENLY' | 'BY_AMOUNT' = 'BY_AMOUNT'
    if (paidFor.length >= 2) {
      const first = paidFor[0].shares
      if (paidFor.every((s) => Math.abs(s.shares - first) <= 1)) {
        splitMode = 'EVENLY'
      }
    }

    expenses.push({
      title,
      expenseDate: date.slice(0, 10),
      category: splitwiseCategoryToId(category),
      amountCurrency: currency,
      amount: amountCents,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      paidBySourceId: payerSourceId,
      paidBy,
      paidFor,
      splitMode,
      recurrenceRule: 'NONE',
      isReimbursement,
      notes: null,
    })
  }

  if (expenses.length === 0) {
    return { ok: false, error: 'CSV had no parseable expenses' }
  }

  let mostCommonCurrency = ''
  let maxCount = 0
  for (const [code, count] of currencyCounts) {
    if (count > maxCount) {
      maxCount = count
      mostCommonCurrency = code
    }
  }

  return {
    ok: true,
    source: {
      provider: 'SPLITWISE',
      sourceGroupId: 'splitwise-csv-import',
      sourceUrl: null,
      name: 'Imported from Splitwise',
      currency: mostCommonCurrency || '',
      currencyCode: mostCommonCurrency || null,
      participants,
      expenses,
    },
  }
}
