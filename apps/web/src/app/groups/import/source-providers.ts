import {
  tryParseSpliitCsv,
  tryParseSpliitExport,
  tryParseSplitwiseCsv,
  type ImportParseResult,
} from '@spliit/domain/import'

export type SourceMode = 'spliit' | 'splitwise' | 'tricount' | 'settleup'

type FileParser =
  | ((text: string) => ImportParseResult)
  | ((input: unknown) => ImportParseResult)

type ProviderConfig = {
  hasUrlPaste: boolean
  hasDomainSwap: boolean
  fileImport: { csv: FileParser; json: FileParser | null } | null
  accept: string
}

export const PROVIDERS: Record<SourceMode, ProviderConfig> = {
  spliit: {
    hasUrlPaste: true,
    hasDomainSwap: true,
    fileImport: { csv: tryParseSpliitCsv, json: tryParseSpliitExport },
    accept: '.json,.csv,application/json,text/csv',
  },
  splitwise: {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: { csv: tryParseSplitwiseCsv, json: null },
    accept: '.csv,text/csv',
  },
  tricount: {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: null,
    accept: '',
  },
  settleup: {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: null,
    accept: '',
  },
}

export function pickParser(
  provider: SourceMode,
  fileName: string,
):
  | { format: 'csv'; parser: FileParser }
  | { format: 'json'; parser: FileParser }
  | { format: null } {
  const cfg = PROVIDERS[provider]
  if (!cfg.fileImport) return { format: null }
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.csv')) {
    return { format: 'csv', parser: cfg.fileImport.csv }
  }
  if (lower.endsWith('.json')) {
    if (!cfg.fileImport.json) return { format: null }
    return { format: 'json', parser: cfg.fileImport.json }
  }
  return { format: null }
}
