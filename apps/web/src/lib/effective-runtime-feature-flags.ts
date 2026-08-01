import {
  useAccountPreferenceUpdater,
  useSyncedAccountPreferences,
} from '@/components/account-preferences-sync'
import type { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { trpc } from '@/trpc/client'

export interface EffectiveRuntimeFeatureFlags {
  /**
   * The runtime feature flags actually available to the current user, with the
   * account-level AI gate and per-user preferences ANDed against the
   * deployment-level env flags.
   */
  flags: RuntimeFeatureFlags
  /**
   * `true` once both `features.get` and the signed-in user's account
   * preferences have resolved. `false` during the initial load — callers that
   * need to gate rendering on a known answer should check this and either show
   * a skeleton or render with all flags off.
   */
  isLoading: boolean
}

/**
 * Combines the deployment-level `features.get` (server-side env gates) with the
 * signed-in user's AI feature preferences from `AccountPreference`.
 *
 * Each AI flag is enabled only when the deployment allows it, the account-level
 * AI gate is on, and the user has not actively opted out. A `null` user
 * preference is treated as "use the default-on behaviour" (the API normalizes
 * that to `true`), so existing accounts behave exactly as before.
 *
 * RACE FIX: the sync layer publishes `ready` only after both
 * `trpc.account.getPreferences` has resolved and any device-default bootstrap
 * write has committed. Until then, AI flags are reported as `false` so an
 * opted-out user never sees a "feature on" flash while the signed-in context is
 * hydrating. Signed-out contexts (`prefsUpdater === null`) settle immediately
 * and read defaults straight from the server flags.
 *
 * Use this hook ONLY at the few "source" points that already consume
 * `features.get`; downstream components keep reading plain booleans from
 * `RuntimeFeatureFlags` so we don't sprinkle per-feature composition throughout
 * the tree.
 */
export function useEffectiveRuntimeFeatureFlags(): EffectiveRuntimeFeatureFlags {
  const features = trpc.features.get.useQuery()
  const prefs = useSyncedAccountPreferences()
  const prefsUpdater = useAccountPreferenceUpdater()
  const serverFlags = features.data
  // Signed-out consumers get `prefsUpdater === null`; nothing to wait for.
  // Signed-in consumers wait for the sync layer to finish bootstrapping
  // defaults so AI flags do not flash "on" before the user's pref arrives.
  const prefsSettled = prefsUpdater === null || prefsUpdater.ready
  const isLoading = features.isLoading || !prefsSettled
  const aiEnabled = prefsSettled && prefs?.aiFeaturesEnabled !== false

  return {
    flags: {
      enableExpenseDocuments: !!serverFlags?.enableExpenseDocuments,
      enableReceiptExtract:
        !!serverFlags?.enableReceiptExtract &&
        aiEnabled &&
        prefs?.aiReceiptScanEnabled !== false,
      enableVoiceExpense:
        !!serverFlags?.enableVoiceExpense &&
        aiEnabled &&
        prefs?.aiVoiceExpenseEnabled !== false,
      enableCategoryExtract:
        !!serverFlags?.enableCategoryExtract &&
        aiEnabled &&
        prefs?.aiCategoryExtractEnabled !== false,
      enableBulkCategorize: !!serverFlags?.enableBulkCategorize,
    },
    isLoading,
  }
}
