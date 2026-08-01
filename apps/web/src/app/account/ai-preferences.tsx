import { Sparkles, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  useAccountPreferenceUpdater,
  useSyncedAccountPreferences,
} from '@/components/account-preferences-sync'
import { Switch } from '@/components/ui/switch'
import { trpc } from '@/trpc/client'

import {
  SettingsBadge,
  SettingsFieldRow,
  SettingsList,
  SettingsRow,
  SettingsSaving,
  SettingsSection,
  SettingsSectionSkeleton,
} from './settings-ui'

type DeploymentFeatures = {
  enableExpenseDocuments: boolean
  enableReceiptExtract: boolean
  enableVoiceExpense: boolean
  enableCategoryExtract: boolean
  enableBulkCategorize: boolean
  defaultCurrencyCode: string
  enableGoogleOAuth: boolean
  enableGitHubOAuth: boolean
}

type AccountPreferences = {
  defaultCurrencyCode: string | null
  timeZone: string | null
  locale: string | null
  theme: 'light' | 'dark' | 'system' | null
  aiFeaturesEnabled?: boolean | null
  aiCategoryExtractEnabled: boolean | null
  aiReceiptScanEnabled: boolean | null
  aiVoiceExpenseEnabled: boolean | null
}

/**
 * Per-user AI feature preferences. Renders nothing at all unless at least one
 * AI capability is available on this deployment — no point in showing an empty
 * "AI features" card for users whose environment never had AI.
 */
export function AccountAiPreferences() {
  const { t } = useTranslation()
  const query = trpc.features.get.useQuery()
  const preferences = useSyncedAccountPreferences()
  const updater = useAccountPreferenceUpdater()
  const patchesDisabled = updater !== null && !updater.ready

  const text = (key: string, fallback: string) =>
    t(`AccountSettings.aiPreferences.${key}` as never, {
      defaultValue: fallback,
    })

  const deploymentFeatures = query.data as DeploymentFeatures | undefined

  if (!deploymentFeatures) {
    return (
      <SettingsSectionSkeleton
        id="ai-preferences"
        title={text('title', 'AI features')}
        description={text(
          'description',
          'Configure AI features and customize how they behave.',
        )}
        icon={Sparkles as LucideIcon}
        rows={3}
      />
    )
  }

  const anyAiFeatureAvailable =
    deploymentFeatures.enableCategoryExtract ||
    deploymentFeatures.enableReceiptExtract ||
    deploymentFeatures.enableVoiceExpense
  const anyComingSoonFeatureAvailable =
    deploymentFeatures.enableReceiptExtract ||
    deploymentFeatures.enableVoiceExpense

  if (!anyAiFeatureAvailable && !anyComingSoonFeatureAvailable) return null

  const pref = preferences as AccountPreferences | null

  const comingSoonBadge = (
    <SettingsBadge>{text('comingSoon', 'Coming soon')}</SettingsBadge>
  )

  return (
    <SettingsSection
      id="ai-preferences"
      title={text('title', 'AI features')}
      description={text(
        'description',
        'Configure AI features and customize how they behave.',
      )}
      icon={Sparkles as LucideIcon}
      status={
        <div className="flex items-center gap-3">
          {updater?.isUpdating ? (
            <SettingsSaving label={text('saving', 'Saving preferences…')} />
          ) : null}
          <Switch
            id="account-ai-preferences-enabled"
            aria-label={text('masterLabel', 'Enable AI features')}
            checked={pref?.aiFeaturesEnabled !== false}
            disabled={patchesDisabled}
            onCheckedChange={(value) =>
              void updater?.patchPreferences({ aiFeaturesEnabled: value })
            }
          />
        </div>
      }
    >
      <SettingsList className="border-t border-border/70">
        {pref?.aiFeaturesEnabled !== false ? (
          <>
            {deploymentFeatures.enableCategoryExtract ? (
              <SettingsFieldRow
                id="account-ai-preferences-category-extract"
                label={text('categoryExtractLabel', 'Expense categorizer')}
                description={text(
                  'categoryExtractDescription',
                  'Suggest a category automatically when you fill in an expense title.',
                )}
                control={
                  <Switch
                    id="account-ai-preferences-category-extract"
                    checked={pref?.aiCategoryExtractEnabled !== false}
                    disabled={patchesDisabled}
                    onCheckedChange={(value) =>
                      void updater?.patchPreferences({
                        aiCategoryExtractEnabled: value,
                      })
                    }
                  />
                }
              />
            ) : null}
            {deploymentFeatures.enableReceiptExtract ? (
              <SettingsFieldRow
                id="account-ai-preferences-receipt-scan"
                label={text('receiptScanLabel', 'Receipt scan')}
                description={text(
                  'receiptScanDescription',
                  'Extract expense details from a receipt photo.',
                )}
                control={
                  <Switch
                    id="account-ai-preferences-receipt-scan"
                    checked={pref?.aiReceiptScanEnabled !== false}
                    disabled={patchesDisabled}
                    onCheckedChange={(value) =>
                      void updater?.patchPreferences({
                        aiReceiptScanEnabled: value,
                      })
                    }
                  />
                }
              />
            ) : null}
            {deploymentFeatures.enableReceiptExtract ? (
              <SettingsRow
                id="account-ai-preferences-receipt-prompts"
                label={text(
                  'receiptPromptsLabel',
                  'Custom instructions for receipt scan',
                )}
                description={text(
                  'receiptPromptsDescription',
                  'Tailor the AI behavior when scanning receipts (currency hints, line-item grouping, etc.).',
                )}
                badges={comingSoonBadge}
              />
            ) : null}
            {deploymentFeatures.enableVoiceExpense ? (
              <SettingsFieldRow
                id="account-ai-preferences-voice-expense"
                label={text('voiceExpenseLabel', 'Voice expense')}
                description={text(
                  'voiceExpenseDescription',
                  'Create an expense from a short voice recording.',
                )}
                control={
                  <Switch
                    id="account-ai-preferences-voice-expense"
                    checked={pref?.aiVoiceExpenseEnabled !== false}
                    disabled={patchesDisabled}
                    onCheckedChange={(value) =>
                      void updater?.patchPreferences({
                        aiVoiceExpenseEnabled: value,
                      })
                    }
                  />
                }
              />
            ) : null}
            {deploymentFeatures.enableVoiceExpense ? (
              <SettingsRow
                id="account-ai-preferences-voice-language"
                label={text('voiceLanguageLabel', 'Preferred voice language')}
                description={text(
                  'voiceLanguageDescription',
                  'Choose the language the voice expense AI listens for.',
                )}
                badges={comingSoonBadge}
              />
            ) : null}
            {deploymentFeatures.enableVoiceExpense ? (
              <SettingsRow
                id="account-ai-preferences-voice-prompts"
                label={text(
                  'voicePromptsLabel',
                  'Custom instructions for voice expense',
                )}
                description={text(
                  'voicePromptsDescription',
                  'Tailor the AI behavior when creating expenses from your voice (splitting, payer defaults, etc.).',
                )}
                badges={comingSoonBadge}
              />
            ) : null}
          </>
        ) : null}
      </SettingsList>
    </SettingsSection>
  )
}
