import { SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useAccountPreferenceUpdater,
  useSyncedAccountPreferences,
} from '@/components/account-preferences-sync'
import { CurrencySelector } from '@/components/currency-selector'
import { LocaleSelector } from '@/components/locale-switcher'
import { useTheme } from '@/components/theme-provider'
import { TimeZoneField } from '@/components/time-zone-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { defaultLocale } from '@/i18n/request'
import { setUserLocale } from '@/i18n/setup'
import {
  detectDeviceTimeZone,
  type AccountPreferences as AccountPreferencesValue,
  type AccountTheme,
} from '@/lib/account-preferences'
import { useCurrencies } from '@/lib/currency'
import { useDeploymentConfig } from '@/lib/deployment-config'
import { trpc } from '@/trpc/client'

import {
  SettingsFieldRow,
  SettingsList,
  SettingsSaving,
  SettingsSection,
  SettingsSectionSkeleton,
} from './settings-ui'

const themes: AccountTheme[] = ['light', 'dark', 'system']

export function AccountPreferences() {
  const { t } = useTranslation()
  const { setTheme } = useTheme()
  const query = trpc.account.getPreferences.useQuery()
  const syncedPreferences = useSyncedAccountPreferences()
  const updater = useAccountPreferenceUpdater()
  const deployment = useDeploymentConfig()
  const allCurrencies = useCurrencies(
    t('GroupForm.CurrencyCodeField.customOption'),
  )
  const themeItems = useMemo(
    () =>
      themes.map((theme) => ({
        value: theme,
        label: t(`Theme.${theme}` as never) as string,
      })),
    [t],
  )
  const currencies = useMemo(
    () => allCurrencies.filter((currency) => currency.code.length === 3),
    [allCurrencies],
  )
  const sourcePreferences =
    syncedPreferences ??
    (query.data?.preferences as AccountPreferencesValue | undefined)
  const deploymentCurrency = deployment.defaultCurrencyCode

  const text = (key: string, fallback: string) =>
    t(`AccountSettings.preferences.${key}` as never, {
      defaultValue: fallback,
    })

  if (!sourcePreferences) {
    return (
      <SettingsSectionSkeleton
        id="app-preferences"
        title={text('title', 'App preferences')}
        description={text(
          'description',
          'Use the same defaults and appearance on every signed-in device.',
        )}
        icon={SlidersHorizontal as LucideIcon}
        rows={4}
      />
    )
  }

  return (
    <SettingsSection
      id="app-preferences"
      title={text('title', 'App preferences')}
      description={text(
        'description',
        'Use the same defaults and appearance on every signed-in device.',
      )}
      icon={SlidersHorizontal as LucideIcon}
      status={
        updater?.isUpdating ? (
          <SettingsSaving label={text('saving', 'Saving preferences…')} />
        ) : undefined
      }
    >
      <SettingsList className="border-t border-border/70">
        <SettingsFieldRow
          id="account-preference-language"
          label={text('language', 'Language')}
          control={
            <LocaleSelector
              id="account-preference-language"
              value={sourcePreferences.locale ?? defaultLocale}
              onValueChange={(locale) => {
                void setUserLocale(locale, { notify: false, persist: false })
                void updater?.patchPreferences({ locale })
              }}
              field
              disabled={updater !== null && !updater.ready}
              className="w-full sm:max-w-xs"
            />
          }
        />
        <SettingsFieldRow
          id="account-preference-default-currency"
          label={text('defaultCurrency', 'Default currency')}
          control={
            <CurrencySelector
              id="account-preference-default-currency"
              currencies={currencies}
              defaultValue={
                sourcePreferences.defaultCurrencyCode ?? deploymentCurrency
              }
              onValueChange={(defaultCurrencyCode) =>
                void updater?.patchPreferences({ defaultCurrencyCode })
              }
              isLoading={false}
            />
          }
        />
        <SettingsFieldRow
          id="account-preference-time-zone"
          label={text('timeZone', 'Account timezone')}
          description={text(
            'timeZoneHelp',
            'Used for account timestamps and captured by new recurring expenses.',
          )}
          control={
            <TimeZoneField
              id="account-preference-time-zone"
              value={sourcePreferences.timeZone ?? detectDeviceTimeZone()}
              onChange={(timeZone) =>
                void updater?.patchPreferences({ timeZone })
              }
            />
          }
        />
        <SettingsFieldRow
          id="account-preference-theme"
          label={text('theme', 'Theme')}
          control={
            <Select
              value={sourcePreferences.theme ?? 'system'}
              disabled={updater !== null && !updater.ready}
              items={themeItems}
              onValueChange={(theme) => {
                const accountTheme = theme as AccountTheme
                setTheme(accountTheme, { notify: false, persist: false })
                void updater?.patchPreferences({ theme: accountTheme })
              }}
            >
              <SelectTrigger
                id="account-preference-theme"
                className="w-full sm:max-w-xs"
              >
                <SelectValue placeholder={text('chooseTheme', 'Choose')} />
              </SelectTrigger>
              <SelectContent>
                {themeItems.map((theme) => (
                  <SelectItem key={theme.value} value={theme.value}>
                    {theme.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsList>
    </SettingsSection>
  )
}
