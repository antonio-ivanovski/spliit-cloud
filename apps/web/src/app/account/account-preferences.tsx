import { Loader2 } from 'lucide-react'
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
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
import { trpc } from '@/trpc/client'

const themes: AccountTheme[] = ['light', 'dark', 'system']

export function AccountPreferences() {
  const { t } = useTranslation()
  const { setTheme } = useTheme()
  const query = trpc.account.getPreferences.useQuery()
  const syncedPreferences = useSyncedAccountPreferences()
  const updater = useAccountPreferenceUpdater()
  const allCurrencies = useCurrencies(
    t('GroupForm.CurrencyCodeField.customOption'),
  )
  const currencies = useMemo(
    () => allCurrencies.filter((currency) => currency.code.length === 3),
    [allCurrencies],
  )
  const sourcePreferences =
    syncedPreferences ??
    (query.data?.preferences as AccountPreferencesValue | undefined)
  const deploymentCurrency = import.meta.env.VITE_DEFAULT_CURRENCY_CODE || 'USD'

  const text = (key: string, fallback: string) =>
    t(`AccountSettings.preferences.${key}` as never, {
      defaultValue: fallback,
    })

  if (!sourcePreferences) {
    return (
      <Card className="mobile-surface min-w-0 overflow-hidden">
        <CardContent className="flex justify-center p-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mobile-surface min-w-0 overflow-hidden">
      <CardHeader className="min-w-0">
        <CardTitle className="flex min-w-0 items-center justify-between gap-3 text-lg">
          <span className="min-w-0 truncate">
            {text('title', 'App preferences')}
          </span>
          {updater?.isUpdating && (
            <Loader2
              className="size-4 shrink-0 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </CardTitle>
        <CardDescription className="break-words">
          {text(
            'description',
            'Use the same defaults and appearance on every signed-in device.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-5">
        <div className="grid min-w-0 gap-1.5">
          <Label>{text('defaultCurrency', 'Default currency')}</Label>
          <CurrencySelector
            currencies={currencies}
            defaultValue={
              sourcePreferences.defaultCurrencyCode ?? deploymentCurrency
            }
            onValueChange={(defaultCurrencyCode) =>
              void updater?.patchPreferences({ defaultCurrencyCode })
            }
            isLoading={false}
          />
        </div>

        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="account-preference-time-zone">
            {text('timeZone', 'Account timezone')}
          </Label>
          <TimeZoneField
            id="account-preference-time-zone"
            value={sourcePreferences.timeZone ?? detectDeviceTimeZone()}
            onChange={(timeZone) =>
              void updater?.patchPreferences({ timeZone })
            }
          />
          <p className="text-xs text-muted-foreground">
            {text(
              'timeZoneHelp',
              'Used for account timestamps and captured by new recurring expenses.',
            )}
          </p>
        </div>

        <div className="grid min-w-0 gap-1.5">
          <Label>{text('language', 'Language')}</Label>
          <LocaleSelector
            value={sourcePreferences.locale ?? defaultLocale}
            onValueChange={(locale) => {
              void setUserLocale(locale, { notify: false, persist: false })
              void updater?.patchPreferences({ locale })
            }}
            field
            disabled={updater !== null && !updater.ready}
          />
        </div>

        <div className="grid min-w-0 gap-1.5">
          <Label>{text('theme', 'Theme')}</Label>
          <Select
            value={sourcePreferences.theme ?? 'system'}
            disabled={updater !== null && !updater.ready}
            onValueChange={(theme) => {
              const accountTheme = theme as AccountTheme
              setTheme(accountTheme, { notify: false, persist: false })
              void updater?.patchPreferences({ theme: accountTheme })
            }}
          >
            <SelectTrigger className="min-w-0">
              <SelectValue placeholder={text('chooseTheme', 'Choose')} />
            </SelectTrigger>
            <SelectContent>
              {themes.map((theme) => (
                <SelectItem key={theme} value={theme}>
                  {t(`Theme.${theme}` as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}
