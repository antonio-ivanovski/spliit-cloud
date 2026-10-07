import {
  ArrowDown,
  ArrowUp,
  CircleOff,
  Eye,
  EyeOff,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState, useSyncExternalStore } from 'react'
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
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
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
  type DestructiveConfirmationLevel,
} from '@/lib/account-preferences'
import { useCurrencies } from '@/lib/currency'
import { useDeploymentConfig } from '@/lib/deployment-config'
import { useCurrentAccount } from '@/lib/use-current-account'
import {
  useOfflineQueryEnabled,
  useRemoteControlState,
} from '@/lib/use-offline-controls'
import { useOnlineStatus } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'
import {
  defaultGroupTabOrder,
  hideableGroupTabIdValues,
  resolveGroupTabOrder,
  type GroupTabId,
  type HideableGroupTabId,
} from '@spliit/domain'

import {
  SettingsFieldRow,
  SettingsList,
  SettingsRow,
  SettingsSaving,
  SettingsSection,
  SettingsSectionSkeleton,
  settingsControlId,
} from './settings-ui'

const themes: AccountTheme[] = ['light', 'dark', 'system']
const mascots: AccountMascot[] = ['off', 'bill']
const destructiveConfirmationLevels: DestructiveConfirmationLevel[] = [
  'standard',
  'strict',
]
const hideableGroupTabIds = new Set<string>(hideableGroupTabIdValues)

function groupTabArraysEqual(
  first: readonly GroupTabId[],
  second: readonly GroupTabId[],
) {
  return (
    first.length === second.length && first.every((id, i) => id === second[i])
  )
}

function hiddenTabSetsEqual(
  first: ReadonlySet<HideableGroupTabId>,
  second: ReadonlySet<HideableGroupTabId>,
) {
  return first.size === second.size && [...first].every((id) => second.has(id))
}

export function AccountPreferences() {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AccountSettings.preferences',
  })
  const { t: tBase } = useTranslation()
  const { setTheme } = useTheme()
  const isOnline = useOnlineStatus()
  const query = trpc.account.getPreferences.useQuery(undefined, {
    enabled: useOfflineQueryEnabled(),
  })
  const syncedPreferences = useSyncedAccountPreferences()
  const updater = useAccountPreferenceUpdater()
  // Remote-write controls (destructive-confirmation level, group-tab
  // customization) disable offline. Local presentation controls below
  // (language, theme, mascot) stay enabled offline by design.
  const remoteControl = useRemoteControlState({
    ready: updater === null || updater.ready,
    busy: updater?.isUpdating,
  })
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
  const destructiveConfirmationItems = useMemo(
    () =>
      destructiveConfirmationLevels.map((level) => ({
        value: level,
        label: t(`deleteConfirmationOptions.${level}`),
      })),
    [t],
  )
  const currencies = useMemo(
    () => allCurrencies.filter((currency) => currency.code.length === 3),
    [allCurrencies],
  )
  const groupTabLabels = useMemo(
    () =>
      ({
        expenses: tBase('Expenses.title'),
        balances: tBase('Balances.title'),
        activity: tBase('Activity.title'),
        members: tBase('Members.title'),
        stats: tBase('Stats.title'),
        budgets: tBase('Budgets.title'),
        tools: tBase('Tools.title'),
        edit: tBase('Settings.title'),
      }) as Record<GroupTabId, string>,
    [tBase],
  )
  const sourcePreferences =
    syncedPreferences ??
    (query.data?.preferences as AccountPreferencesValue | undefined)
  const deploymentCurrency = deployment.defaultCurrencyCode
  const [groupTabsOpen, setGroupTabsOpen] = useState(false)
  const [draftOrder, setDraftOrder] = useState<GroupTabId[]>([])
  const [draftHidden, setDraftHidden] = useState<Set<HideableGroupTabId>>(
    () => new Set(),
  )
  const currentHidden = useMemo(
    () => new Set(sourcePreferences?.hiddenGroupTabs ?? []),
    [sourcePreferences?.hiddenGroupTabs],
  )

  if (!sourcePreferences) {
    // First load needs the server; cached preferences (via the sync provider)
    // render immediately when they exist. Never skeleton-spin forever offline.
    if (!isOnline) {
      return (
        <SettingsSection
          id="app-preferences"
          title={t('title')}
          description={t('description')}
          icon={SlidersHorizontal as LucideIcon}
        >
          <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-6 sm:pb-5">
            {tBase('OfflineReadOnly.needsConnection')}
          </p>
        </SettingsSection>
      )
    }
    return (
      <SettingsSectionSkeleton
        id="app-preferences"
        title={t('title')}
        description={t('description')}
        icon={SlidersHorizontal as LucideIcon}
        rows={6}
      />
    )
  }

  const MascotPreview = getMascotDefinition(sourcePreferences.mascot)?.Character

  const currentOrder = resolveGroupTabOrder(sourcePreferences.groupTabOrder)
  const visibleTabLabels = currentOrder
    .filter((tab) => !currentHidden.has(tab as HideableGroupTabId))
    .map((tab) => groupTabLabels[tab])
    .join(' · ')
  const draftDirty =
    !groupTabArraysEqual(draftOrder, currentOrder) ||
    !hiddenTabSetsEqual(draftHidden, currentHidden)

  function openGroupTabsDialog() {
    setDraftOrder([...currentOrder])
    setDraftHidden(new Set(currentHidden))
    setGroupTabsOpen(true)
  }

  function moveDraftTab(index: number, direction: -1 | 1) {
    setDraftOrder((order) => {
      const target = index + direction
      if (target < 0 || target >= order.length) return order
      const next = [...order]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  function toggleDraftHidden(tab: GroupTabId) {
    if (!hideableGroupTabIds.has(tab)) return
    const hideable = tab as HideableGroupTabId
    setDraftHidden((hidden) => {
      const next = new Set(hidden)
      if (next.has(hideable)) next.delete(hideable)
      else next.add(hideable)
      return next
    })
  }

  function resetDraftTabs() {
    setDraftOrder([...defaultGroupTabOrder])
    setDraftHidden(new Set())
  }

  async function saveDraftTabs() {
    const order = groupTabArraysEqual(draftOrder, [...defaultGroupTabOrder])
      ? null
      : draftOrder
    const hidden = draftHidden.size === 0 ? null : [...draftHidden]
    const ok = await updater?.patchPreferences({
      groupTabOrder: order,
      hiddenGroupTabs: hidden,
    })
    if (ok !== false) setGroupTabsOpen(false)
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
        <SettingsFieldRow
          id="account-preference-destructive-confirmation-level"
          label={t('deleteConfirmation')}
          description={t('deleteConfirmationHelp')}
          control={
            <Select
              value={sourcePreferences.destructiveConfirmationLevel ?? 'strict'}
              disabled={remoteControl.disabled}
              items={destructiveConfirmationItems}
              onValueChange={(level) => {
                void updater?.patchPreferences({
                  destructiveConfirmationLevel:
                    level as DestructiveConfirmationLevel,
                })
              }}
            >
              <SelectTrigger
                id={settingsControlId(
                  'account-preference-destructive-confirmation-level',
                )}
                className="w-full sm:max-w-xs"
              >
                <SelectValue placeholder={t('deleteConfirmation')} />
              </SelectTrigger>
              <SelectContent>
                {destructiveConfirmationItems.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    {level.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          id="account-preference-group-tabs"
          label={t('groupTabs')}
          description={
            <>
              <p>{t('groupTabsHelp')}</p>
              <p className="mt-1 min-w-0 break-words">{visibleTabLabels}</p>
            </>
          }
          control={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={remoteControl.disabled}
              onClick={openGroupTabsDialog}
            >
              {t('groupTabsCustomize')}
            </Button>
          }
        />
      </SettingsList>

      <ResponsiveDialog open={groupTabsOpen} onOpenChange={setGroupTabsOpen}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('groupTabs')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('groupTabsHelp')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="flex flex-col gap-3">
            <ol className="divide-y divide-border/70 rounded-lg border border-border/70 bg-background">
              {draftOrder.map((tab, index) => {
                const hideable = hideableGroupTabIds.has(tab)
                const hidden = draftHidden.has(tab as HideableGroupTabId)
                const HiddenIcon = hidden ? EyeOff : Eye
                return (
                  <li
                    key={tab}
                    data-hidden={hidden || undefined}
                    className="flex min-w-0 items-center gap-1 py-1 ps-3 pe-1 data-[hidden]:opacity-60"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {groupTabLabels[tab]}
                    </span>
                    {hideable ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        aria-label={
                          hidden
                            ? t('groupTabsShow', { name: groupTabLabels[tab] })
                            : t('groupTabsHide', { name: groupTabLabels[tab] })
                        }
                        aria-pressed={hidden}
                        onClick={() => toggleDraftHidden(tab)}
                      >
                        <HiddenIcon className="size-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      disabled={index === 0}
                      aria-label={t('groupTabsMoveUp', {
                        name: groupTabLabels[tab],
                      })}
                      onClick={() => moveDraftTab(index, -1)}
                    >
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      disabled={index === draftOrder.length - 1}
                      aria-label={t('groupTabsMoveDown', {
                        name: groupTabLabels[tab],
                      })}
                      onClick={() => moveDraftTab(index, 1)}
                    >
                      <ArrowDown className="size-4" aria-hidden="true" />
                    </Button>
                  </li>
                )
              })}
            </ol>
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start text-muted-foreground"
                onClick={resetDraftTabs}
              >
                {t('groupTabsReset')}
              </Button>
            </div>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setGroupTabsOpen(false)}
            >
              {t('groupTabsDiscard')}
            </Button>
            <Button
              type="button"
              disabled={!draftDirty || remoteControl.disabled}
              onClick={() => void saveDraftTabs()}
            >
              {t('groupTabsSave')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </SettingsSection>
  )
}
