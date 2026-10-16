/**
 * Provider registry for group importers.
 *
 * A new tabular importer is: header labels + category map + one entry here. The
 * wizard, file routing, filename hints, and the tsx `run*` helpers all derive
 * from this table.
 *
 * Parse and file routing resolve through the registry (`parseText`,
 * `discriminate`, `detectProvidersFromText`). The wizard keeps its own
 * provider-gated chrome (cloud-bundle flow, anonymizer card, URL paste, tab
 * content) in `apps/web/src/app/groups/import/` — those `provider ===` branches
 * are UI flow, not parsing.
 *
 * `spliit-cloud` (zip bundles) is intentionally absent: it is a bundle flow,
 * not a `NormalizedSource` parser, and stays on its own path.
 */

import { Effect } from 'effect'

import {
  buildImportBatch,
  type ImportBatchResult,
  type ImportBatchState,
  type ImportRatesByKey,
} from './batch'
import { parseCospendCsv, parseCospendTable } from './cospend-csv'
import {
  COSPEND_BILL_HEADER,
  COSPEND_MEMBER_HEADER,
  isCospendHeader,
} from './cospend-headers'
import {
  cospendFilenameHint,
  settleUpFilenameHint,
  splitwiseFilenameHint,
  tricountFilenameHint,
} from './filename'
import { parseSettleUpCsv, parseSettleUpTable } from './settleup-csv'
import { mapSettleUpHeader } from './settleup-headers'
import { parseSpliitExport } from './spliit'
import { parseSpliitCsv, parseSpliitTable } from './spliit-csv'
import { detectSpliitCsvLayout } from './spliit-headers'
import { parseSplitwiseCsv, parseSplitwiseTable } from './splitwise-csv'
import { isSplitwiseHeader } from './splitwise-headers'
import { decodeCsvRowsLenient } from './table'
import { parseTricountApiResponse } from './tricount-api'
import {
  parseTricountCsv,
  parseTricountCsvSingle,
  parseTricountTable,
} from './tricount-csv'
import { mapTricountHeader } from './tricount-headers'
import {
  importErrorToParseResult,
  type ImportError,
  type ImportParseResult,
  type NormalizedSource,
} from './types'

export type ProviderId =
  | 'spliit'
  | 'splitwise'
  | 'cospend'
  | 'tricount'
  | 'settleup'

export type FileKind = 'csv' | 'json'

export type ProviderDef = {
  id: ProviderId
  /** Normalized provider tag written into `NormalizedSource.provider`. */
  sourceProvider: 'SPLIIT' | 'SPLITWISE' | 'COSPEND' | 'TRICOUNT' | 'SETTLEUP'
  fileKinds: readonly FileKind[]
  /**
   * Data discriminator: does this provider own the decoded table? Runs the
   * provider's header sniff over rows (header row may sit below blank/prefix
   * lines). Powers data-driven file routing — no `if provider ===` branches.
   * Returns false for headerless/unknown tables.
   */
  discriminate: (rows: string[][]) => boolean
  /**
   * Parse decoded table rows. Tricount resolves `NormalizedSource[]`
   * (multi-group dumps); every other provider resolves one source.
   */
  parseTable: (
    rows: string[][],
  ) => Effect.Effect<NormalizedSource | NormalizedSource[], ImportError>
  /** Parse raw file text (or decoded JSON body for `json` kinds). */
  parseText: (
    input: string,
  ) => Effect.Effect<NormalizedSource | NormalizedSource[], ImportError>
  /** Provider-specific filename → group-name hint, or null. */
  filenameHint: (filename: string) => string | null
  /** Single-group file entry (multi-group providers reject here). */
  parseSingle: (input: string) => Effect.Effect<NormalizedSource, ImportError>
  /**
   * Translation key suffix for provider-scoped UI copy (tab label, description,
   * drop-file text, export guide). Resolved under `Groups.Import.Source.*` —
   * e.g. `splitwise` → `splitwiseDescription`.
   */
  i18nKey: string
  /**
   * Whether the provider offers a share-link paste flow (server-side preview).
   * Currently tricount-only; the generic tab renders the paste card behind this
   * flag so the next URL-based provider needs no tsx branch.
   */
  shareLink: boolean
}

function spliitFilenameHint(_filename: string): string | null {
  return null
}

/** True when any row in the table matches the predicate. */
function anyRow(rows: string[][], match: (row: string[]) => boolean): boolean {
  return rows.some((row) => match(row))
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  spliit: {
    id: 'spliit',
    sourceProvider: 'SPLIIT',
    fileKinds: ['csv', 'json'],
    discriminate: (rows) =>
      rows.length > 0 && detectSpliitCsvLayout(rows[0]!) !== null,
    parseTable: (rows) => parseSpliitTable(rows),
    parseText: (input) => parseSpliitCsv(input),
    filenameHint: spliitFilenameHint,
    parseSingle: (input) => parseSpliitCsv(input),
    i18nKey: 'spliit',
    shareLink: false,
  },
  splitwise: {
    id: 'splitwise',
    sourceProvider: 'SPLITWISE',
    fileKinds: ['csv'],
    discriminate: (rows) => anyRow(rows, (row) => isSplitwiseHeader(row)),
    parseTable: (rows) => parseSplitwiseTable(rows),
    parseText: (input) => parseSplitwiseCsv(input),
    filenameHint: splitwiseFilenameHint,
    parseSingle: (input) => parseSplitwiseCsv(input),
    i18nKey: 'splitwise',
    shareLink: false,
  },
  cospend: {
    id: 'cospend',
    sourceProvider: 'COSPEND',
    fileKinds: ['csv'],
    discriminate: (rows) =>
      anyRow(rows, (row) => isCospendHeader(row, COSPEND_MEMBER_HEADER)) &&
      anyRow(rows, (row) => isCospendHeader(row, COSPEND_BILL_HEADER)),
    parseTable: (rows) => parseCospendTable(rows),
    parseText: (input) => parseCospendCsv(input),
    filenameHint: cospendFilenameHint,
    parseSingle: (input) => parseCospendCsv(input),
    i18nKey: 'cospend',
    shareLink: false,
  },
  tricount: {
    id: 'tricount',
    sourceProvider: 'TRICOUNT',
    fileKinds: ['csv'],
    discriminate: (rows) =>
      anyRow(rows, (row) => mapTricountHeader(row) !== null),
    parseTable: (rows) => parseTricountTable(rows),
    parseText: (input) => parseTricountCsv(input),
    filenameHint: tricountFilenameHint,
    parseSingle: (input) => parseTricountCsvSingle(input),
    i18nKey: 'tricount',
    shareLink: true,
  },
  settleup: {
    id: 'settleup',
    sourceProvider: 'SETTLEUP',
    fileKinds: ['csv'],
    discriminate: (rows) =>
      anyRow(rows, (row) => mapSettleUpHeader(row) !== null),
    parseTable: (rows) => parseSettleUpTable(rows),
    parseText: (input) => parseSettleUpCsv(input),
    filenameHint: settleUpFilenameHint,
    parseSingle: (input) => parseSettleUpCsv(input),
    i18nKey: 'settleup',
    shareLink: false,
  },
}

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[]

export function getProvider(id: ProviderId): ProviderDef {
  return PROVIDERS[id]!
}

export type RunParseSingleResult = ImportParseResult
export type RunParseRegistryResult =
  | ImportParseResult
  | { ok: true; sources: NormalizedSource[] }

/**
 * Run an Effect parse synchronously for tsx, mapping failure to plain
 * `ImportParseResult` data. The single wrapper for every `run*` edge helper —
 * React components call those, never `Effect.runSync` directly.
 */
function runSyncToResult<T, R>(
  effect: Effect.Effect<T, ImportError>,
  mapOk: (value: T) => R,
): R | ImportParseResult {
  try {
    return mapOk(Effect.runSync(effect))
  } catch (error) {
    return importErrorToParseResult(error)
  }
}

/**
 * Tsx edge helper: run a provider's single-group parse synchronously and return
 * plain `ImportParseResult`. React components call this — never
 * `Effect.runSync` directly.
 */
export function runParseSingle(
  id: ProviderId,
  input: string,
): ImportParseResult {
  // parseSingle never resolves multi-group; assert the single shape so the
  // shared wrapper type narrows to ImportParseResult.
  return runSyncToResult(PROVIDERS[id]!.parseSingle(input), (source) => ({
    ok: true as const,
    source: Array.isArray(source) ? source[0]! : source,
  }))
}

/**
 * Tsx edge helper: run a provider's (possibly multi-group) parse synchronously
 * and return plain data. React components call this — never `Effect.runSync`
 * directly.
 */
export function runParseWithRegistry(
  id: ProviderId,
  input: string,
): ImportParseResult | { ok: true; sources: NormalizedSource[] } {
  return runSyncToResult(PROVIDERS[id]!.parseText(input), (result) =>
    Array.isArray(result)
      ? { ok: true as const, sources: result }
      : { ok: true as const, source: result },
  )
}

/**
 * Data-driven content probe: which registered providers accept this text
 * payload? Header discrimination runs first (cheap: one CSV decode + header
 * sniffs); payloads no discriminator claims fall through to the full-parse
 * probe. Pure routing signal for "wrong tab" detection — unknown bytes match
 * nothing. Order follows registry insertion (spliit first).
 */
export function detectProvidersFromText(text: string): ProviderId[] {
  const matches = new Set<ProviderId>()
  const probeRows = tryDecodeTableRows(text)
  if (probeRows) {
    for (const id of discriminateProviders(probeRows)) matches.add(id)
  }
  // Spliit JSON has no tabular header: probe the JSON decode directly.
  if (text.trimStart().startsWith('{')) {
    try {
      if (runParseSpliitJson(JSON.parse(text)).ok) matches.add('spliit')
    } catch {
      // Not JSON — leave the CSV probes below to decide.
    }
  }
  if (matches.size > 0) return [...matches]
  // No discriminator claimed the payload (headerless, renamed, or partial
  // file): fall back to full-parse acceptance, one provider at a time.
  if (!probeRows) return matchesFromFullParse(text)
  for (const id of PROVIDER_IDS) {
    if (matches.has(id)) continue
    if (isAcceptedByFullParse(id, text)) matches.add(id)
  }
  return [...matches]
}

/** Best-effort CSV decode for header sniffing; null when not tabular. */
function tryDecodeTableRows(text: string): string[][] | null {
  // Tricount/SettleUp sniff ';' vs ','; every other tabular provider is ','.
  // Decode under both so the discriminator sees the payload's real shape;
  // return the first decode a discriminator claims, else the comma decode
  // for the full-parse fallback.
  let fallback: string[][] | null = null
  for (const delimiter of [',', ';'] as const) {
    const rows = decodeCsvRowsLenient(text, delimiter)
    if (rows.length === 0) continue
    fallback ??= rows
    if (discriminateProviders(rows).length > 0) return rows
  }
  return fallback
}

function matchesFromFullParse(text: string): ProviderId[] {
  // The spliit JSON probe already ran in the caller (and missed — otherwise
  // we would have returned); only the tabular full-parse probes remain.
  const matches: ProviderId[] = []
  for (const id of PROVIDER_IDS) {
    if (id !== 'spliit' && isAcceptedByFullParse(id, text)) matches.push(id)
  }
  return matches
}

/** True when the provider's full parse accepts the text (routing only). */
function isAcceptedByFullParse(id: ProviderId, text: string): boolean {
  try {
    // flip succeeds (no throw) means parseText failed — not a match.
    return !Effect.runSync(Effect.flip(PROVIDERS[id]!.parseText(text)))
  } catch {
    // flip threw means parseText succeeded — provider accepts the text.
    return true
  }
}

/** Provider ids whose header discriminator claims the decoded table. */
export function discriminateProviders(rows: string[][]): ProviderId[] {
  return PROVIDER_IDS.filter((id) => {
    try {
      return PROVIDERS[id]!.discriminate(rows)
    } catch {
      return false
    }
  })
}

/** JSON-body entry for the spliit provider (file + URL-preview paths). */
export function runParseSpliitJson(body: unknown): ImportParseResult {
  return runSyncToResult(parseSpliitExport(body), (source) => ({
    ok: true as const,
    source,
  }))
}

/** API-side entry: normalize a raw Tricount registry payload. */
export function runParseTricountApi(
  payload: unknown,
  sourceUrl: string | null,
): ImportParseResult {
  return runSyncToResult(
    parseTricountApiResponse(payload, sourceUrl),
    (source) => ({
      ok: true as const,
      source,
    }),
  )
}

/**
 * Tsx edge helper: build the import batch synchronously and return plain data.
 * React components call this — never `Effect.runSync` directly. Failures
 * surface as the same `ImportError`-derived message the wizard toast already
 * renders (`BATCH_*` codes preserved in `code`).
 */
export function runBuildBatch(
  state: ImportBatchState,
  destinationCurrencyCode: string,
  rates?: ImportRatesByKey,
): ImportBatchResult | ImportParseResult {
  return runSyncToResult(
    buildImportBatch(state, destinationCurrencyCode, rates),
    (batch) => batch,
  )
}

export type { ImportError }
