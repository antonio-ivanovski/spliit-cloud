import { CircleOff, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useAccountPreferenceUpdater,
  useSyncedAccountPreferences,
} from '@/components/account-preferences-sync'
import { CurrencySelector } from '@/components/currency-selector'
import { LocaleSelector } from '@/components/locale-switcher'
import { BillCharacter } from '@/components/mascot/bill-character'
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
  type AccountMascot,
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
const mascots: AccountMascot[] = ['off', 'bill']

export function AccountPreferences() {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AccountSettings.preferences',
  })
  const { t: tBase } = useTranslation()
  const { setTheme } = useTheme()
  const query = trpc.account.getPreferences.useQuery()
  const syncedPreferences = useSyncedAccountPreferences()
  const updater = useAccountPreferenceUpdater()
  const deployment = useDeploymentConfig()
  const allCurrencies = useCurrencies(
    tBase('GroupForm.CurrencyCodeField.customOption'),
  )
  const themeItems = useMemo(
    () =>
      themes.map((theme) => ({
        value: theme,
        label: tBase(`Theme.${theme}` as `Theme.${AccountTheme}`),
      })),
    [tBase],
  )
  const mascotItems = useMemo(
    () =>
      mascots.map((mascot) => ({
        value: mascot,
        label: t(`mascotOptions.${mascot}`),
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

  if (!sourcePreferences) {
    return (
      <SettingsSectionSkeleton
        id="app-preferences"
        title={t('title')}
        description={t('description')}
        icon={SlidersHorizontal as LucideIcon}
        rows={5}
      />
    )
  }

  return (
    <SettingsSection
      id="app-preferences"
      title={t('title')}
      description={t('description')}
      icon={SlidersHorizontal as LucideIcon}
      status={
        updater?.isUpdating ? <SettingsSaving label={t('saving')} /> : undefined
      }
    >
      <SettingsList className="border-t border-border/70">
        <SettingsFieldRow
          id="account-preference-language"
          label={t('language')}
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
          label={t('defaultCurrency')}
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
          label={t('timeZone')}
          description={t('timeZoneHelp')}
          control={
            <TimeZoneField
              id="account-preference-time-zone"
              className="sm:max-w-xs"
              value={sourcePreferences.timeZone ?? detectDeviceTimeZone()}
              onChange={(timeZone) =>
                void updater?.patchPreferences({ timeZone })
              }
            />
          }
        />
        <SettingsFieldRow
          id="account-preference-theme"
          label={t('theme')}
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
                <SelectValue placeholder={t('chooseTheme')} />
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
        <SettingsFieldRow
          id="account-preference-mascot"
          label={t('mascot')}
          description={t('mascotHelp')}
          control={
            <div className="flex w-full items-center gap-3 sm:max-w-xs">
              <div className="flex size-14 shrink-0 items-center justify-center overflow-visible rounded-2xl border border-primary/15 bg-primary/7 shadow-inner">
                {sourcePreferences.mascot === 'bill' ? (
                  <BillCharacter className="h-[66px] w-[58px]" />
                ) : (
                  <CircleOff
                    className="size-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
              </div>
              <Select
                value={sourcePreferences.mascot ?? 'off'}
                disabled={updater !== null && !updater.ready}
                items={mascotItems}
                onValueChange={(mascot) =>
                  void updater?.patchPreferences({
                    mascot: mascot as AccountMascot,
                  })
                }
              >
                <SelectTrigger
                  id="account-preference-mascot"
                  className="flex-1"
                >
                  <SelectValue placeholder={t('chooseMascot')} />
                </SelectTrigger>
                <SelectContent>
                  {mascotItems.map((mascot) => (
                    <SelectItem key={mascot.value} value={mascot.value}>
                      {mascot.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />
      </SettingsList>
    </SettingsSection>
  )
}
