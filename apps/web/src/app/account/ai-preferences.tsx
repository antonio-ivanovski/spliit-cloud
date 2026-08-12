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
  settingsControlId,
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
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AccountSettings.aiPreferences',
  })
  const query = trpc.features.get.useQuery()
  const preferences = useSyncedAccountPreferences()
  const updater = useAccountPreferenceUpdater()
  const patchesDisabled = updater !== null && !updater.ready

  const deploymentFeatures = query.data as DeploymentFeatures | undefined

  if (!deploymentFeatures) {
    return (
      <SettingsSectionSkeleton
        id="ai-preferences"
        title={t('title')}
        description={t('description')}
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

  const comingSoonBadge = <SettingsBadge>{t('comingSoon')}</SettingsBadge>

  return (
    <SettingsSection
      id="ai-preferences"
      title={t('title')}
      description={t('description')}
      icon={Sparkles as LucideIcon}
      status={
        <div className="flex items-center gap-3">
          {updater?.isUpdating ? <SettingsSaving label={t('saving')} /> : null}
          <Switch
            id="account-ai-preferences-enabled"
            aria-label={t('masterLabel')}
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
                label={t('categoryExtractLabel')}
                description={t('categoryExtractDescription')}
                control={
                  <Switch
                    id={settingsControlId(
                      'account-ai-preferences-category-extract',
                    )}
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
                label={t('receiptScanLabel')}
                description={t('receiptScanDescription')}
                control={
                  <Switch
                    id={settingsControlId(
                      'account-ai-preferences-receipt-scan',
                    )}
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
                label={t('receiptPromptsLabel')}
                description={t('receiptPromptsDescription')}
                badges={comingSoonBadge}
              />
            ) : null}
            {deploymentFeatures.enableVoiceExpense ? (
              <SettingsFieldRow
                id="account-ai-preferences-voice-expense"
                label={t('voiceExpenseLabel')}
                description={t('voiceExpenseDescription')}
                control={
                  <Switch
                    id={settingsControlId(
                      'account-ai-preferences-voice-expense',
                    )}
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
                label={t('voiceLanguageLabel')}
                description={t('voiceLanguageDescription')}
                badges={comingSoonBadge}
              />
            ) : null}
            {deploymentFeatures.enableVoiceExpense ? (
              <SettingsRow
                id="account-ai-preferences-voice-prompts"
                label={t('voicePromptsLabel')}
                description={t('voicePromptsDescription')}
                badges={comingSoonBadge}
              />
            ) : null}
          </>
        ) : null}
      </SettingsList>
    </SettingsSection>
  )
}
