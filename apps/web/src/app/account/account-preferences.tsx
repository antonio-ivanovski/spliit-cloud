import { CircleOff, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useAccountPreferenceUpdater,
  useSyncedAccountPreferences,
} from '@/components/account-preferences-sync'
import { CurrencySelector } from '@/components/currency-selector'
import { LocaleSelector } from '@/components/locale-switcher'
import {
  readMascotPin,
  subscribeMascotPin,
  writeMascotPin,
} from '@/components/mascot/mascot-pin'
import {
  getMascotDefinition,
  isActiveMascot,
} from '@/components/mascot/mascot-registry'
import { markMascotSettingsDiscovered } from '@/components/mascot/mascot-settings-discovery'
import { useTheme } from '@/components/theme-provider'
import { TimeZoneField } from '@/components/time-zone-field'
import { Button } from '@/components/ui/button'
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
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'

import {
  SettingsFieldRow,
  SettingsList,
  SettingsSaving,
  SettingsSection,
  SettingsSectionSkeleton,
  settingsControlId,
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
  const { data: account } = useCurrentAccount()
  const pin = useSyncExternalStore(
    subscribeMascotPin,
    () => readMascotPin(account?.id),
    () => null,
  )
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

  const MascotPreview = getMascotDefinition(sourcePreferences.mascot)?.Character

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
              id={settingsControlId('account-preference-language')}
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
              id={settingsControlId('account-preference-default-currency')}
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
              id={settingsControlId('account-preference-time-zone')}
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
                id={settingsControlId('account-preference-theme')}
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
            <div className="flex w-full min-w-0 flex-col items-stretch">
              <div className="flex w-full items-center gap-3">
                <div className="min-w-0 flex-1 sm:w-[11rem] sm:flex-none">
                  <Select
                    value={sourcePreferences.mascot ?? 'bill'}
                    disabled={updater !== null && !updater.ready}
                    items={mascotItems}
                    onValueChange={(mascot) => {
                      markMascotSettingsDiscovered(account?.id)
                      void updater?.patchPreferences({
                        mascot: mascot as AccountMascot,
                      })
                    }}
                  >
                    <SelectTrigger
                      id={settingsControlId('account-preference-mascot')}
                      className="w-full"
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
                <div
                  className="flex size-14 shrink-0 items-center justify-center"
                  data-testid="account-preference-mascot-preview"
                >
                  {MascotPreview ? (
                    <MascotPreview className="h-[66px] w-[58px]" />
                  ) : (
                    <CircleOff
                      className="size-5 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </div>
              </div>
              {isActiveMascot(sourcePreferences.mascot) && pin ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 self-start text-muted-foreground"
                  data-testid="account-preference-mascot-reset-position"
                  onClick={() => writeMascotPin(account?.id, null)}
                >
                  {tBase('Mascot.resetPosition')}
                </Button>
              ) : null}
            </div>
          }
        />
      </SettingsList>
    </SettingsSection>
  )
}
