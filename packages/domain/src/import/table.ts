/**
 * Shared tabular parsing kit for group importers.
 *
 * Every CSV importer repeats the same plumbing: BOM strip, Papa parse,
 * blank-row skip, number/date cells, dominant-currency vote. This module is the
 * single home for those primitives — pure functions, no provider knowledge.
 * Only `parseCsvText` returns an Effect (file-level failure); everything else
 * is plain data.
 */

import { Effect } from 'effect'
import Papa from 'papaparse'

import type { Currency } from '../currency'
import { ImportError } from './types'

export const FALLBACK_CURRENCY: Currency = {
  code: '',
  symbol: '',
  rounding: 0,
  decimal_digits: 2,
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export type CsvParseOptions = {
  /**
   * Defaults to ','. Tricount/SettleUp sniff ';' vs ',' — pass the sniffed
   * value.
   */
  delimiter?: string
  /** Defaults to 'greedy'. Tricount/SettleUp use `false` (footer rows matter). */
  skipEmptyLines?: 'greedy' | false
}

export const parseCsvText = Effect.fnUntraced(function* (
  text: string,
  options?: CsvParseOptions,
): Effect.fn.Return<string[][], ImportError> {
  const cleaned = stripBom(text)
  const parsed = Papa.parse<string[]>(cleaned, {
    skipEmptyLines: options?.skipEmptyLines ?? 'greedy',
    header: false,
    ...(options?.delimiter ? { delimiter: options.delimiter } : {}),
  })
  const rows = parsed.data
  if (rows.length < 2) {
    return yield* new ImportError({
      message: 'CSV has no data rows',
      code: 'CSV_NO_DATA_ROWS',
      params: {},
    })
  }
  if (parsed.errors.length > 0) {
    const detail = parsed.errors[0]?.message ?? 'unknown error'
    return yield* new ImportError({
      message: `CSV could not be parsed: ${detail}`,
      code: 'CSV_PARSE_FAILED',
      params: { detail },
    })
  }
  return rows
})

/** Sniff ';' vs ',' from the first line (Tricount/SettleUp convention). */
export function sniffDelimiter(text: string): ',' | ';' {
  const firstLine = stripBom(text).split('\n', 1)[0] ?? ''
  return firstLine.split(';').length > firstLine.split(',').length ? ';' : ','
}

/**
 * Lenient CSV decode for content routing: never fails, returns whatever rows
 * Papa produces (possibly empty). Header discriminators decide ownership;
 * file-level validation stays in `parseCsvText` / the parsers.
 */
export function decodeCsvRowsLenient(
  text: string,
  delimiter?: ',' | ';',
): string[][] {
  const cleaned = stripBom(text)
  const parsed = Papa.parse<string[]>(cleaned, {
    skipEmptyLines: 'greedy',
    header: false,
    ...(delimiter ? { delimiter } : {}),
  })
  return parsed.data
}

export function isBlankCell(value: string | undefined): boolean {
  return (value ?? '').trim() === ''
}

export function isBlankRow(row: readonly (string | undefined)[]): boolean {
  return row.every((cell) => isBlankCell(cell))
}

export function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/**
 * `YYYY-MM-DD` prefix from the importers' date shapes: `YYYY-MM-DD HH:mm:ss`
 * (Splitwise/Spliit/SettleUp), `YYYYMMDD` and `YYYY/MM/DD` (Sesterce),
 * Unix-seconds fallback handled per-parser (Cospend `timestamp`).
 */
export function parseDatePrefix(value: string): string | null {
  const trimmed = value.trim()
  const iso = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]!
  const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const slashed = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})/)
  if (slashed) return `${slashed[1]}-${slashed[2]}-${slashed[3]}`
  return null
}

/**
 * Strict `YYYY-MM-DD` prefix. Splitwise/Spliit/Cospend historically only
 * accepted ISO dates (anything else skipped the row); they keep that rule while
 * Tricount/SettleUp use the broader {@link parseDatePrefix}.
 */
export function parseIsoDatePrefix(value: string): string | null {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] ?? null
}

/**
 * Unknown-valued number cell (API payloads carry numbers and numeric strings).
 * Null unless the value parses finite.
 */
export function toNumberOrNullApi(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  return toNumberOrNull(value)
}

/** Unknown-valued text cell (API payloads carry mixed JSON). */
export function optionalText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Most-common currency code from per-row votes; '' when no rows voted. */
export function dominantCurrency(counts: ReadonlyMap<string, number>): string {
  let best = ''
  let maxCount = 0
  for (const [code, count] of counts) {
    if (count > maxCount) {
      maxCount = count
      best = code
    }
  }
  return best
}

/**
 * Decode upload/attachment bytes (or text) to a JS string. Real Settle Up
 * exports are UTF-16LE with a BOM; tolerate BE, BOM-less UTF-16, and plain
 * UTF-8/ASCII (a lone `�` means it was not actually UTF-16). Returns null when
 * the payload cannot be decoded as text.
 */
export function decodeBytesText(input: string | Uint8Array): string | null {
  if (typeof input === 'string') {
    return stripBom(input)
  }
  const bytes = input
  if (bytes.length === 0) return null
  const hasLeBom = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
  const hasBeBom = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff
  let nulEven = 0
  let nulOdd = 0
  const sample = Math.min(bytes.length, 64)
  for (let i = 0; i < sample; i++) {
    if (bytes[i] === 0) {
      if (i % 2 === 0) nulEven++
      else nulOdd++
    }
  }
  const looksLe = hasLeBom || (!hasBeBom && nulOdd > nulEven && nulOdd > 0)
  const looksBe = hasBeBom || (!hasLeBom && nulEven > nulOdd && nulEven > 0)
  try {
    if (looksLe) {
      const text = new TextDecoder('utf-16le').decode(bytes)
      if (!text.includes('�')) return stripBom(text)
    } else if (looksBe) {
      const text = new TextDecoder('utf-16be').decode(bytes)
      if (!text.includes('�')) return stripBom(text)
    }
    if (hasLeBom || hasBeBom) return null
    return stripBom(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    // Not UTF-16 and not valid UTF-8 (e.g. an Excel-resaved Latin-1 CSV):
    // decode leniently like `file.text()` does so amounts still import and
    // only the affected glyphs mangle, instead of blocking the import.
    try {
      if (hasLeBom || hasBeBom) return null
      return stripBom(new TextDecoder('utf-8').decode(bytes))
    } catch {
      return null
    }
  }
}
