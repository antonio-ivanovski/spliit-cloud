import type { Effect } from 'effect'

import {
  parseCospendCsv,
  parseSettleUpCsv,
  parseSpliitCsv,
  parseSpliitExport,
  parseSplitwiseCsv,
  parseTricountCsvSingle,
  type ImportError,
  type NormalizedSource,
} from '@spliit/domain/import'

export type SourceMode =
  | 'spliit'
  | 'spliit-cloud'
  | 'splitwise'
  | 'cospend'
  | 'tricount'
  | 'settleup'

export type FileParser = (
  input: never,
) => Effect.Effect<NormalizedSource, ImportError>

type ProviderConfig = {
  hasUrlPaste: boolean
  hasDomainSwap: boolean
  fileImport: {
    csv?: FileParser
    json?: FileParser
    cloud?: true
  } | null
  accept: string
}

export const PROVIDERS: Record<SourceMode, ProviderConfig> = {
  spliit: {
    hasUrlPaste: true,
    hasDomainSwap: true,
    fileImport: {
      csv: parseSpliitCsv as FileParser,
      json: parseSpliitExport as FileParser,
    },
    accept: '.json,.csv,application/json,text/csv',
  },
  'spliit-cloud': {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: { cloud: true },
    accept: '.spliit.zip,.zip,application/zip,application/x-zip-compressed',
  },
  splitwise: {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: { csv: parseSplitwiseCsv as FileParser },
    accept: '.csv,text/csv',
  },
  cospend: {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: { csv: parseCospendCsv as FileParser },
    accept: '.csv,text/csv',
  },
  tricount: {
    // Share-link fetch (api.tricount.bunq.com) is phase 2; CSV only for now.
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: { csv: parseTricountCsvSingle as FileParser },
    accept: '.csv,text/csv',
  },
  settleup: {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: { csv: parseSettleUpCsv as FileParser },
    accept: '.csv,text/csv',
  },
}

export function pickParser(
  provider: SourceMode,
  fileName: string,
):
  | { format: 'csv'; parser: FileParser }
  | { format: 'json'; parser: FileParser }
  | { format: 'cloud' }
  | { format: null } {
  const cfg = PROVIDERS[provider]
  if (!cfg.fileImport) return { format: null }
  const lower = fileName.toLowerCase()
  if (cfg.fileImport.cloud && lower.endsWith('.zip')) {
    return { format: 'cloud' }
  }
  if (lower.endsWith('.csv')) {
    return cfg.fileImport.csv
      ? { format: 'csv', parser: cfg.fileImport.csv }
      : { format: null }
  }
  if (lower.endsWith('.json')) {
    return cfg.fileImport.json
      ? { format: 'json', parser: cfg.fileImport.json }
      : { format: null }
  }
  return { format: null }
}
