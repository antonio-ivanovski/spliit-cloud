import {
  PROVIDERS as DOMAIN_PROVIDERS,
  type ProviderId,
} from '@spliit/domain/import'

export type SourceMode = ProviderId | 'spliit-cloud'

type ProviderConfig = {
  hasUrlPaste: boolean
  hasDomainSwap: boolean
  /** Null for non-file providers; `cloud` marks the zip-bundle flow. */
  fileImport: { cloud: true } | { table: true } | null
  accept: string
  /**
   * True when the tab renders its own content (multi-group routing) instead of
   * the shared description + file-upload cards. Currently tricount-only; the
   * next multi-source provider flips this flag — no tsx branch.
   */
  customTab: boolean
}

export const PROVIDERS: Record<SourceMode, ProviderConfig> = {
  spliit: {
    hasUrlPaste: true,
    hasDomainSwap: true,
    fileImport: { table: true },
    accept: '.json,.csv,application/json,text/csv',
    customTab: false,
  },
  'spliit-cloud': {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: { cloud: true },
    accept: '.spliit.zip,.zip,application/zip,application/x-zip-compressed',
    customTab: false,
  },
  splitwise: {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: { table: true },
    accept: '.csv,text/csv',
    customTab: false,
  },
  cospend: {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: { table: true },
    accept: '.csv,text/csv',
    customTab: false,
  },
  tricount: {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: { table: true },
    accept: '.csv,text/csv',
    customTab: true,
  },
  settleup: {
    hasUrlPaste: false,
    hasDomainSwap: false,
    fileImport: { table: true },
    accept: '.csv,text/csv',
    customTab: false,
  },
}

export type PickedParser =
  | { format: 'csv'; provider: ProviderId }
  | { format: 'json'; provider: 'spliit' }
  | { format: 'cloud' }
  | { format: null }

/**
 * Route a filename to its parse entry. CSV kinds resolve through the domain
 * registry (`parseSingle`); JSON stays spliit-only; zips route to the Cloud
 * bundle flow.
 */
export function pickParser(
  provider: SourceMode,
  fileName: string,
): PickedParser {
  const cfg = PROVIDERS[provider]
  if (!cfg.fileImport) return { format: null }
  const lower = fileName.toLowerCase()
  if ('cloud' in cfg.fileImport && lower.endsWith('.zip')) {
    return { format: 'cloud' }
  }
  if (lower.endsWith('.csv')) {
    if (provider === 'spliit-cloud') return { format: null }
    const def = DOMAIN_PROVIDERS[provider as ProviderId]
    return def && def.fileKinds.includes('csv')
      ? { format: 'csv', provider: provider as ProviderId }
      : { format: null }
  }
  if (lower.endsWith('.json')) {
    return provider === 'spliit'
      ? { format: 'json', provider: 'spliit' }
      : { format: null }
  }
  return { format: null }
}

export type ProviderCopy = {
  tabLabel: string
  description: string
  dropFile: string
  dropFileDescription: string
  receiptTitle: string | null
  receiptDescription: string | null
}

function pickCopy(
  t: (key: string) => string,
  base: string,
  receiptTitleKey: string | null,
): ProviderCopy {
  return {
    tabLabel: t(`Groups.Import.Source.${base}`),
    description: t(`Groups.Import.Source.${base}Description`),
    dropFile: t(`Groups.Import.Source.dropFile${capitalize(base)}`),
    dropFileDescription: t(
      `Groups.Import.Source.dropFileDescription${capitalize(base)}`,
    ),
    receiptTitle: receiptTitleKey ? t(receiptTitleKey) : null,
    receiptDescription: receiptTitleKey
      ? t(receiptTitleKey.replace('Title', 'Description'))
      : null,
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}

/**
 * Registry-driven UI copy for a tabular provider tab. Keys derive from the
 * domain registry's `i18nKey` — no per-provider switch in tsx. Spliit is the
 * exception: its keys predate the `${Key}Description` convention
 * (`spliitDescription` exists but `dropFileSpliit` does not — the generic
 * `dropFile` is used), so it resolves explicitly.
 */
export function getProviderCopy(
  provider: ProviderId,
  t: (key: string) => string,
): ProviderCopy {
  const i18nKey = DOMAIN_PROVIDERS[provider].i18nKey
  if (provider === 'spliit') {
    return {
      tabLabel: t('Groups.Import.Source.fromSpliit'),
      description: t('Groups.Import.Source.spliitDescription'),
      dropFile: t('Groups.Import.Source.dropFile'),
      dropFileDescription: t('Groups.Import.Source.dropFileDescription'),
      receiptTitle: null,
      receiptDescription: null,
    }
  }
  if (i18nKey === 'settleup') {
    return {
      tabLabel: t('Groups.Import.Source.settleUp'),
      description: t('Groups.Import.Source.settleUpDescription'),
      dropFile: t('Groups.Import.Source.dropFileSettleUp'),
      dropFileDescription: t(
        'Groups.Import.Source.dropFileDescriptionSettleUp',
      ),
      receiptTitle: t('Groups.Import.Source.receiptWarningTitleSettleUp'),
      receiptDescription: t(
        'Groups.Import.Source.receiptWarningDescriptionSettleUp',
      ),
    }
  }
  if (i18nKey === 'tricount') {
    // Tricount copy predates the convention (`tricount` tab label key,
    // `dropFileTricount` without a receipt warning).
    return {
      tabLabel: t('Groups.Import.Source.tricount'),
      description: t('Groups.Import.Source.exportGuide.tricountDescription'),
      dropFile: t('Groups.Import.Source.dropFileTricount'),
      dropFileDescription: t(
        'Groups.Import.Source.dropFileDescriptionTricount',
      ),
      receiptTitle: null,
      receiptDescription: null,
    }
  }
  const capitalized = i18nKey === 'settleup' ? 'SettleUp' : capitalize(i18nKey)
  return pickCopy(
    t,
    i18nKey,
    `Groups.Import.Source.receiptWarningTitle${capitalized}`,
  )
}

export type FileGuide = {
  trigger: string
  title: string
  steps: Array<{ index: number; text: string }>
  artifact?: string
  artifactLabel?: string
  artifactDetail?: string
  tip?: string
}

/**
 * Registry-driven export-guide content for the file-upload card. Step keys
 * follow the `${guide}StepN` convention (count varies per provider);
 * artifact/tip keys are optional per provider. Spliit-cloud keeps its bespoke
 * shape (extra artifact detail + tip); tricount has no file card (its tab
 * renders `GenericSourceTab` with its own guides) and resolves empty.
 */
export function getFileGuide(
  provider: SourceMode,
  t: (key: string) => string,
): FileGuide {
  if (provider === 'spliit-cloud') {
    return {
      trigger: t('Groups.Import.Source.exportGuide.spliitCloudTrigger'),
      title: t('Groups.Import.Source.exportGuide.spliitCloudTitle'),
      steps: [1, 2, 3].map((index) => ({
        index,
        text: t(`Groups.Import.Source.exportGuide.spliitCloudStep${index}`),
      })),
      artifact: '.spliit.zip',
      artifactLabel: t('Groups.Import.Source.exportGuide.artifactLabel'),
      artifactDetail: t(
        'Groups.Import.Source.exportGuide.spliitCloudArtifactDetail',
      ),
      tip: t('Groups.Import.Source.exportGuide.spliitCloudTip'),
    }
  }
  if (provider === 'tricount') {
    return { trigger: '', title: '', steps: [] }
  }
  if (provider === 'spliit') {
    return {
      trigger: t('Groups.Import.Source.exportGuide.spliitFileTrigger'),
      title: t('Groups.Import.Source.exportGuide.spliitFileDialogTitle'),
      steps: [1, 2].map((index) => ({
        index,
        text: t(`Groups.Import.Source.exportGuide.spliitFileStep${index}`),
      })),
      artifact: '.json / .csv',
    }
  }
  const guide = DOMAIN_PROVIDERS[provider].i18nKey
  // Export-guide keys use the UI spelling (`settleUpTrigger`), not the
  // registry id (`settleup`).
  const guideKey = guide === 'settleup' ? 'settleUp' : guide
  return {
    trigger: t(`Groups.Import.Source.exportGuide.${guideKey}Trigger`),
    title: t(`Groups.Import.Source.exportGuide.${guideKey}Title`),
    steps: [1, 2, 3].map((index) => ({
      index,
      text: t(`Groups.Import.Source.exportGuide.${guideKey}Step${index}`),
    })),
    artifact: '*.csv',
    artifactLabel: t('Groups.Import.Source.exportGuide.artifactLabel'),
    artifactDetail: t(
      `Groups.Import.Source.exportGuide.${guideKey}ArtifactDetail`,
    ),
    tip: t(`Groups.Import.Source.exportGuide.${guideKey}Tip`),
  }
}

/** Tab labels + card copy for the tab strip, in provider order. */
export function getTabLabels(t: (key: string) => string): Array<{
  value: SourceMode
  label: string
}> {
  const modes: SourceMode[] = [
    'spliit',
    'spliit-cloud',
    'splitwise',
    'cospend',
    'tricount',
    'settleup',
  ]
  return modes.map((mode) => ({
    value: mode,
    label:
      mode === 'spliit'
        ? t('Groups.Import.Source.fromSpliit')
        : mode === 'spliit-cloud'
          ? t('Groups.Import.Source.fromSpliitCloud')
          : getProviderCopy(mode, t).tabLabel,
  }))
}
