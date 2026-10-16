/**
 * Workbook seam for future XLSX importers (Kittysplit, Splid Excel).
 *
 * Types only — no spreadsheet dependency is added in this slice. When an XLSX
 * loader lands (lazy `import()` of SheetJS/exceljs in the web client), it
 * decodes each sheet to `SheetTable` and feeds the picked table into the
 * provider's existing `parseTable(rows)` — no new parser needed.
 */

/** One decoded workbook sheet: name + dense string grid. */
export type SheetTable = {
  name: string
  rows: string[][]
}

/**
 * Pick the expense sheet from a decoded workbook. Heuristic stub: the table
 * with the most non-blank rows wins; ties resolve to the first sheet. A
 * provider-specific picker (header sniffing) replaces this when the first XLSX
 * importer lands.
 */
export function pickExpenseSheet(sheets: SheetTable[]): SheetTable | null {
  if (sheets.length === 0) return null
  let best: SheetTable | null = null
  let bestScore = 0
  for (const sheet of sheets) {
    let score = 0
    for (const row of sheet.rows) {
      if (row.some((cell) => (cell ?? '').trim() !== '')) score++
    }
    if (score > bestScore) {
      bestScore = score
      best = sheet
    }
  }
  return bestScore > 0 ? (best ?? sheets[0]!) : null
}
