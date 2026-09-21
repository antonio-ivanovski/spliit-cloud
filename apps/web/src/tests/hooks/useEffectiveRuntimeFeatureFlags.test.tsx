import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEffectiveRuntimeFeatureFlags } from '@/lib/effective-runtime-feature-flags'
import type { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { render, screen } from '@/test/test-utils'

type Preferences = {
  aiFeaturesEnabled?: boolean | null
  aiCategoryExtractEnabled: boolean | null
  aiReceiptScanEnabled: boolean | null
  aiVoiceExpenseEnabled: boolean | null
}

type Updater = {
  ready: boolean
  isUpdating: boolean
  patchPreferences: () => unknown
} | null

const mocks = vi.hoisted(() => ({
  serverFeatures: undefined as RuntimeFeatureFlags | undefined,
  serverFeaturesLoading: false,
  preferences: undefined as Preferences | undefined,
  updater: null as Updater,
}))

vi.mock('@/components/account-preferences-sync', () => ({
  useSyncedAccountPreferences: () => mocks.preferences,
  useAccountPreferenceUpdater: () => mocks.updater,
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    features: {
      get: {
        useQuery: () => ({
          data: mocks.serverFeatures,
          isLoading: mocks.serverFeaturesLoading,
        }),
      },
    },
  },
}))

function Probe() {
  const { flags, isLoading } = useEffectiveRuntimeFeatureFlags()
  return (
    <div
      data-testid="flags"
      data-loading={isLoading ? 'true' : 'false'}
      data-receipt={flags.enableReceiptExtract ? 'true' : 'false'}
      data-voice={flags.enableVoiceExpense ? 'true' : 'false'}
      data-category={flags.enableCategoryExtract ? 'true' : 'false'}
      data-bulk={flags.enableBulkCategorize ? 'true' : 'false'}
    />
  )
}

function readFlags() {
  const el = screen.getByTestId('flags')
  return {
    isLoading: el.getAttribute('data-loading') === 'true',
    enableReceiptExtract: el.getAttribute('data-receipt') === 'true',
    enableVoiceExpense: el.getAttribute('data-voice') === 'true',
    enableCategoryExtract: el.getAttribute('data-category') === 'true',
    enableBulkCategorize: el.getAttribute('data-bulk') === 'true',
  }
}

describe('useEffectiveRuntimeFeatureFlags', () => {
  beforeEach(() => {
    mocks.serverFeatures = undefined
    mocks.serverFeaturesLoading = false
    mocks.preferences = undefined
    mocks.updater = null
  })

  it('reports all flags off when the server query has not resolved', () => {
    mocks.serverFeaturesLoading = true
    mocks.updater = {
      ready: false,
      isUpdating: false,
      patchPreferences: () => undefined,
    }

    render(<Probe />)

    expect(readFlags()).toEqual({
      isLoading: true,
      enableReceiptExtract: false,
      enableVoiceExpense: false,
      enableCategoryExtract: false,
      enableBulkCategorize: false,
    })
  })

  it('flags server features as on for a signed-in user with default prefs', () => {
    mocks.serverFeatures = {
      enableExpenseDocuments: true,
      enableReceiptExtract: true,
      enableVoiceExpense: true,
      enableCategoryExtract: true,
      enableBulkCategorize: false,
      enableDictionarySuggest: true,
      enableHistorySuggest: true,
      categoryEngine: 'llm',
      categoryLocalThresholds: {
        minScore: 0.7,
        settlementMinScore: 0.95,
      },
      aiMinConfidence: 0.5,
    }
    mocks.updater = {
      ready: true,
      isUpdating: false,
      patchPreferences: () => undefined,
    }
    // API normalizes the AI fields to `true` for users who have never
    // actively disabled the feature.
    mocks.preferences = {
      aiCategoryExtractEnabled: true,
      aiReceiptScanEnabled: true,
      aiVoiceExpenseEnabled: true,
    }

    render(<Probe />)

    expect(readFlags()).toEqual({
      isLoading: false,
      enableReceiptExtract: true,
      enableVoiceExpense: true,
      enableCategoryExtract: true,
      enableBulkCategorize: false,
    })
  })

  it('hides AI features when the signed-in user opted out', () => {
    mocks.serverFeatures = {
      enableExpenseDocuments: true,
      enableReceiptExtract: true,
      enableVoiceExpense: true,
      enableCategoryExtract: true,
      enableBulkCategorize: false,
      enableDictionarySuggest: true,
      enableHistorySuggest: true,
      categoryEngine: 'llm',
      categoryLocalThresholds: {
        minScore: 0.7,
        settlementMinScore: 0.95,
      },
      aiMinConfidence: 0.5,
    }
    mocks.updater = {
      ready: true,
      isUpdating: false,
      patchPreferences: () => undefined,
    }
    mocks.preferences = {
      aiCategoryExtractEnabled: false,
      aiReceiptScanEnabled: false,
      aiVoiceExpenseEnabled: false,
    }

    render(<Probe />)

    expect(readFlags()).toEqual({
      isLoading: false,
      enableReceiptExtract: false,
      enableVoiceExpense: false,
      enableCategoryExtract: false,
      enableBulkCategorize: false,
    })
  })

  it('hides every AI surface when the account master switch is off', () => {
    mocks.serverFeatures = {
      enableExpenseDocuments: true,
      enableReceiptExtract: true,
      enableVoiceExpense: true,
      enableCategoryExtract: true,
      enableBulkCategorize: false,
      enableDictionarySuggest: true,
      enableHistorySuggest: true,
      categoryEngine: 'llm',
      categoryLocalThresholds: {
        minScore: 0.7,
        settlementMinScore: 0.95,
      },
      aiMinConfidence: 0.5,
    }
    mocks.updater = {
      ready: true,
      isUpdating: false,
      patchPreferences: () => undefined,
    }
    mocks.preferences = {
      aiFeaturesEnabled: false,
      aiCategoryExtractEnabled: true,
      aiReceiptScanEnabled: true,
      aiVoiceExpenseEnabled: true,
    }

    render(<Probe />)

    expect(readFlags()).toEqual({
      isLoading: false,
      enableReceiptExtract: false,
      enableVoiceExpense: false,
      enableCategoryExtract: false,
      enableBulkCategorize: false,
    })
  })

  it('keeps AI flags off until the signed-in prefs layer reports ready', () => {
    // Regression for the prefs race: when the user has opted out but the
    // sync context has not yet published `ready`, we must NOT briefly
    // expose the AI surface as enabled before the pref arrives.
    mocks.serverFeatures = {
      enableExpenseDocuments: true,
      enableReceiptExtract: true,
      enableVoiceExpense: true,
      enableCategoryExtract: true,
      enableBulkCategorize: false,
      enableDictionarySuggest: true,
      enableHistorySuggest: true,
      categoryEngine: 'llm',
      categoryLocalThresholds: {
        minScore: 0.7,
        settlementMinScore: 0.95,
      },
      aiMinConfidence: 0.5,
    }
    mocks.updater = {
      ready: false, // sync layer still hydrating
      isUpdating: false,
      patchPreferences: () => undefined,
    }
    mocks.preferences = {
      aiCategoryExtractEnabled: false,
      aiReceiptScanEnabled: false,
      aiVoiceExpenseEnabled: false,
    }

    render(<Probe />)

    expect(readFlags()).toEqual({
      isLoading: true,
      enableReceiptExtract: false,
      enableVoiceExpense: false,
      enableCategoryExtract: false,
      enableBulkCategorize: false,
    })
  })

  it('treats a null updater (signed-out) as ready immediately', () => {
    mocks.serverFeatures = {
      enableExpenseDocuments: true,
      enableReceiptExtract: true,
      enableVoiceExpense: true,
      enableCategoryExtract: true,
      enableBulkCategorize: false,
      enableDictionarySuggest: true,
      enableHistorySuggest: true,
      categoryEngine: 'llm',
      categoryLocalThresholds: {
        minScore: 0.7,
        settlementMinScore: 0.95,
      },
      aiMinConfidence: 0.5,
    }
    mocks.updater = null

    render(<Probe />)

    expect(readFlags()).toEqual({
      isLoading: false,
      enableReceiptExtract: true,
      enableVoiceExpense: true,
      enableCategoryExtract: true,
      enableBulkCategorize: false,
    })
  })

  it('passes suggest stages through without per-user AI gating', () => {
    // Local stages are deterministic, not AI: deployment switches apply even
    // when the user opted out of AI features.
    mocks.serverFeatures = {
      enableExpenseDocuments: true,
      enableReceiptExtract: true,
      enableVoiceExpense: true,
      enableCategoryExtract: true,
      enableBulkCategorize: false,
      enableDictionarySuggest: false,
      enableHistorySuggest: true,
      categoryEngine: 'system-one',
      categoryLocalThresholds: {
        minScore: 0.8,
        settlementMinScore: 0.97,
      },
      aiMinConfidence: 0.6,
    }
    mocks.updater = {
      ready: true,
      isUpdating: false,
      patchPreferences: () => undefined,
    }
    mocks.preferences = {
      aiFeaturesEnabled: false,
      aiCategoryExtractEnabled: false,
      aiReceiptScanEnabled: false,
      aiVoiceExpenseEnabled: false,
    }

    function StageProbe() {
      const { flags } = useEffectiveRuntimeFeatureFlags()
      return (
        <div
          data-testid="stages"
          data-dictionary={flags.enableDictionarySuggest ? 'true' : 'false'}
          data-history={flags.enableHistorySuggest ? 'true' : 'false'}
          data-engine={flags.categoryEngine}
          data-min-score={flags.categoryLocalThresholds.minScore}
          data-ai-floor={flags.aiMinConfidence}
        />
      )
    }

    render(<StageProbe />)
    const el = screen.getByTestId('stages')
    expect(el.getAttribute('data-dictionary')).toBe('false')
    expect(el.getAttribute('data-history')).toBe('true')
    expect(el.getAttribute('data-engine')).toBe('system-one')
    expect(el.getAttribute('data-min-score')).toBe('0.8')
    expect(el.getAttribute('data-ai-floor')).toBe('0.6')
  })
})
