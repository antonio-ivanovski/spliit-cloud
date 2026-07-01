import Papa from 'papaparse'

const PARTICIPANT_START_INDEX = 5

export type AnonymizedSplitwiseCsv = {
  outputCsv: string
  // Always `splitwise-anonymized.csv` so the downloaded filename never
  // leaks the original export name (which Splitwise often seeds with
  // the group or user name).
  outputName: string
}

/**
 * Produces an anonymized copy of a Splitwise CSV export, suitable for
 * attaching to a public bug report. The mapping is intentionally simple:
 * each participant header gets a stable `Person N` label, and each
 * distinct description (case-insensitive) becomes `Expense N`. All
 * numeric data — dates, costs, currencies, per-participant amounts,
 * categories — is left untouched because it is what makes the file
 * useful for diagnosing an import issue.
 *
 * Throws if the input does not look like a Splitwise export (same
 * header shape that `tryParseSplitwiseCsv` requires).
 */
export function anonymizeSplitwiseCsv(input: string): AnonymizedSplitwiseCsv {
  const cleaned = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const parsed = Papa.parse<string[]>(cleaned, {
    skipEmptyLines: 'greedy',
    header: false,
  })

  let headerRowIdx = -1
  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i]
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
    throw new Error('CSV header is not a Splitwise export')
  }
  const header = parsed.data[headerRowIdx]
  if (!header || header.length <= PARTICIPANT_START_INDEX) {
    throw new Error('CSV is missing participant columns')
  }

  const originalToAnonParticipant = new Map<string, string>()
  let participantCounter = 0
  for (let i = PARTICIPANT_START_INDEX; i < header.length; i++) {
    const name = (header[i] ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (originalToAnonParticipant.has(key)) continue
    originalToAnonParticipant.set(key, `Person ${++participantCounter}`)
  }

  const newHeader = header.slice()
  for (let i = PARTICIPANT_START_INDEX; i < newHeader.length; i++) {
    const name = (newHeader[i] ?? '').trim()
    const key = name.toLowerCase()
    const anon = originalToAnonParticipant.get(key)
    if (anon) newHeader[i] = anon
  }

  const descriptionToAnon = new Map<string, string>()
  let expenseCounter = 0
  function anonDescription(raw: string): string {
    const trimmed = raw.trim()
    if (!trimmed) return raw
    const key = trimmed.toLowerCase()
    const cached = descriptionToAnon.get(key)
    if (cached) return cached
    const anon = `Expense ${++expenseCounter}`
    descriptionToAnon.set(key, anon)
    return anon
  }

  const rows = parsed.data.map((row, rowIdx) => {
    if (rowIdx === headerRowIdx) return newHeader
    const newRow = row.slice()
    if (newRow.length < 2) return newRow
    newRow[1] = anonDescription(newRow[1] ?? '')
    return newRow
  })

  return {
    outputCsv: Papa.unparse(rows),
    outputName: 'splitwise-anonymized.csv',
  }
}
