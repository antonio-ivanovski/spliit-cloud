import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { useTheme } from '@/components/theme-provider'
import { TimeZoneMismatchDialog } from '@/components/time-zone-mismatch-dialog'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { detectLocale, setUserLocale } from '@/i18n/setup'
import {
  ACCOUNT_LOCALE_CHANGED_EVENT,
  ACCOUNT_THEME_CHANGED_EVENT,
  cacheAccountPreferences,
  detectDeviceTimeZone,
  getExplicitLocaleCookie,
  getExplicitStoredTheme,
  readCachedAccountPreferences,
  type AccountPreferences,
  type AccountTheme,
} from '@/lib/account-preferences'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'

/**
 * Bridges device-local presentation settings and the signed-in account.
 * Initialization is intentionally sparse: the API only fills null fields, so
 * signing in on another device can never overwrite an established preference.
 */
const AccountPreferencesContext = createContext<AccountPreferences | null>(null)
const AccountPreferenceUpdateContext = createContext<{
  ready: boolean
  isUpdating: boolean
  patchPreferences: (
    patch: Partial<AccountPreferences>,
    options?: { optimistic?: boolean },
  ) => Promise<boolean>
} | null>(null)
const StartupTimeZoneCheckContext = createContext({
  checked: true,
  promptActive: false,
})

export function AccountPreferencesSync({ children }: PropsWithChildren) {
  const { data: account } = useCurrentAccount()

  if (!account) {
    return (
      <StartupTimeZoneCheckContext.Provider
        value={{ checked: true, promptActive: false }}
      >
        <AccountPreferencesContext.Provider value={null}>
          {children}
        </AccountPreferencesContext.Provider>
      </StartupTimeZoneCheckContext.Provider>
    )
  }

  return (
    <AccountPreferenceSession key={account.id} accountId={account.id}>
      {children}
    </AccountPreferenceSession>
  )
}

function AccountPreferenceSession({
  children,
  accountId,
}: PropsWithChildren<{ accountId: string }>) {
  const { theme, setTheme } = useTheme()
  const { t } = useTranslation()
  const { toast } = useToast()
  const locale = useLocale()
  const [cached] = useState(() => readCachedAccountPreferences(accountId))
  const [deviceDefaults] = useState(() => ({
    locale: detectLocale(),
    theme: getExplicitStoredTheme() ?? ('system' as const),
    timeZone: detectDeviceTimeZone(),
  }))
  const bootstrapInFlight = useRef(false)
  const latestPreferences = useRef<AccountPreferences | null>(cached)
  const confirmedPreferences = useRef<AccountPreferences | null>(cached)
  const updateQueue = useRef<Promise<unknown>>(Promise.resolve())
  const pendingPatches = useRef<
    Array<{ id: number; patch: Partial<AccountPreferences> }>
  >([])
  const nextPatchId = useRef(0)
  const pendingWrites = useRef(0)
  const [isUpdating, setIsUpdating] = useState(false)
  const [bootstrapRetry, setBootstrapRetry] = useState(0)
  const [initializedPreferences, setInitializedPreferences] =
    useState<AccountPreferences | null>(null)
  const [timeZoneCheck, setTimeZoneCheck] = useState({
    checked: false,
    promptActive: false,
  })
  const utils = trpc.useUtils()
  const preferencesQuery = trpc.account.getPreferences.useQuery(undefined, {
    staleTime: 0,
  })
  const preferencesData = preferencesQuery.data
  const initialize = trpc.account.initializePreferences.useMutation()
  const update = trpc.account.updatePreferences.useMutation()

  const serverPreferences = preferencesData?.preferences as
    | AccountPreferences
    | undefined
  const serverNeedsInitialization =
    serverPreferences !== undefined &&
    Object.values(serverPreferences).some((value) => value === null)
  const authoritativePreferences =
    serverNeedsInitialization && initializedPreferences
      ? initializedPreferences
      : (serverPreferences ?? initializedPreferences)
  const resolved = authoritativePreferences ?? cached
  const needsInitialization =
    initializedPreferences === null && serverNeedsInitialization
  const bootstrapComplete =
    authoritativePreferences != null &&
    !Object.values(authoritativePreferences).some((value) => value === null)

  const publishOptimisticPreferences = useCallback(
    (confirmed: AccountPreferences) => {
      const optimistic = pendingPatches.current.reduce(
        (preferences, pending) => ({ ...preferences, ...pending.patch }),
        confirmed,
      )
      latestPreferences.current = optimistic
      utils.account.getPreferences.setData(undefined, {
        preferences: optimistic,
      })
    },
    [utils.account.getPreferences],
  )
  const persistPresentationCache = useCallback(
    (preferences: AccountPreferences) => {
      if (preferences.theme) {
        setTheme(preferences.theme, { notify: false, persist: true })
      }
      if (preferences.locale) {
        void setUserLocale(preferences.locale, {
          notify: false,
          persist: true,
        })
      }
    },
    [setTheme],
  )

  useEffect(() => {
    if (!serverPreferences || !needsInitialization || bootstrapInFlight.current)
      return
    bootstrapInFlight.current = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    void initialize
      .mutateAsync({
        locale:
          serverPreferences.locale ??
          getExplicitLocaleCookie() ??
          deviceDefaults.locale,
        theme:
          serverPreferences.theme ??
          getExplicitStoredTheme() ??
          deviceDefaults.theme,
        timeZone: serverPreferences.timeZone ?? deviceDefaults.timeZone,
      })
      .then((result) => {
        const preferences = result.preferences as AccountPreferences
        latestPreferences.current = preferences
        confirmedPreferences.current = preferences
        cacheAccountPreferences(accountId, preferences)
        persistPresentationCache(preferences)
        utils.account.getPreferences.setData(undefined, result)
        setInitializedPreferences(preferences)
      })
      .catch(() => {
        toast({
          variant: 'destructive',
          description: t('AccountSettings.preferences.saveError' as never, {
            defaultValue: 'Could not save preferences',
          }),
        })
        retryTimer = setTimeout(
          () => setBootstrapRetry((attempt) => attempt + 1),
          5_000,
        )
      })
      .finally(() => {
        bootstrapInFlight.current = false
      })
    return () => {
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [
    accountId,
    bootstrapRetry,
    deviceDefaults,
    initialize,
    needsInitialization,
    persistPresentationCache,
    serverPreferences,
    t,
    toast,
    utils,
  ])

  useEffect(() => {
    latestPreferences.current = resolved
    if (!authoritativePreferences || pendingPatches.current.length > 0) return
    confirmedPreferences.current = authoritativePreferences
    cacheAccountPreferences(accountId, authoritativePreferences)
  }, [accountId, authoritativePreferences, resolved])

  useEffect(() => {
    if (resolved?.theme && resolved.theme !== theme) {
      setTheme(resolved.theme, {
        notify: false,
        persist: pendingPatches.current.length === 0,
      })
    }
  }, [resolved?.theme, setTheme, theme])

  useEffect(() => {
    if (resolved?.locale && resolved.locale !== locale) {
      void setUserLocale(resolved.locale, {
        notify: false,
        persist: pendingPatches.current.length === 0,
      })
    }
  }, [locale, resolved?.locale])

  const patchPreferences = useCallback(
    (
      patch: Partial<AccountPreferences>,
      options: { optimistic?: boolean } = {},
    ) => {
      const current = latestPreferences.current
      if (!current) return Promise.resolve(false)

      const patchId = ++nextPatchId.current
      pendingPatches.current.push({ id: patchId, patch })
      if (options.optimistic !== false) {
        const optimistic = { ...current, ...patch }
        latestPreferences.current = optimistic
        utils.account.getPreferences.setData(undefined, {
          preferences: optimistic,
        })
      }

      pendingWrites.current += 1
      setIsUpdating(true)
      const write = updateQueue.current
        .catch(() => undefined)
        .then(async () => {
          const result = await update.mutateAsync(patch)
          const preferences = result.preferences as AccountPreferences
          pendingPatches.current = pendingPatches.current.filter(
            (pending) => pending.id !== patchId,
          )
          confirmedPreferences.current = preferences
          cacheAccountPreferences(accountId, preferences)
          persistPresentationCache(preferences)
          publishOptimisticPreferences(preferences)
          return true
        })
        .catch(() => {
          pendingPatches.current = pendingPatches.current.filter(
            (pending) => pending.id !== patchId,
          )
          const confirmed = confirmedPreferences.current
          if (confirmed) publishOptimisticPreferences(confirmed)
          toast({
            variant: 'destructive',
            description: t('AccountSettings.preferences.saveError' as never, {
              defaultValue: 'Could not save preferences',
            }),
          })
          return false
        })
        .finally(() => {
          pendingWrites.current -= 1
          if (pendingWrites.current > 0) return

          setIsUpdating(false)
        })
      updateQueue.current = write
      return write
    },
    [
      accountId,
      persistPresentationCache,
      publishOptimisticPreferences,
      t,
      toast,
      update,
      utils,
    ],
  )

  useEffect(() => {
    const onTheme = (event: Event) => {
      const theme = (event as CustomEvent<AccountTheme>).detail
      const current = latestPreferences.current
      if (!current || current.theme === theme) return
      void patchPreferences({ theme })
    }
    const onLocale = (event: Event) => {
      const locale = (event as CustomEvent<string>).detail
      const current = latestPreferences.current
      if (!current || current.locale === locale) return
      void patchPreferences({
        locale: locale as AccountPreferences['locale'],
      })
    }
    window.addEventListener(ACCOUNT_THEME_CHANGED_EVENT, onTheme)
    window.addEventListener(ACCOUNT_LOCALE_CHANGED_EVENT, onLocale)
    return () => {
      window.removeEventListener(ACCOUNT_THEME_CHANGED_EVENT, onTheme)
      window.removeEventListener(ACCOUNT_LOCALE_CHANGED_EVENT, onLocale)
    }
  }, [patchPreferences])

  return (
    <StartupTimeZoneCheckContext.Provider value={timeZoneCheck}>
      <AccountPreferenceUpdateContext.Provider
        value={{ ready: resolved !== null, isUpdating, patchPreferences }}
      >
        <AccountPreferencesContext.Provider value={resolved}>
          <TimeZoneMismatchDialog
            accountId={accountId}
            enabled={bootstrapComplete}
            accountTimeZone={resolved?.timeZone ?? null}
            patchPreferences={patchPreferences}
            onStatusChange={setTimeZoneCheck}
          />
          {children}
        </AccountPreferencesContext.Provider>
      </AccountPreferenceUpdateContext.Provider>
    </StartupTimeZoneCheckContext.Provider>
  )
}

// react-doctor-disable-next-line react-doctor/only-export-components -- context hook
export function useSyncedAccountPreferences() {
  return useContext(AccountPreferencesContext)
}

// react-doctor-disable-next-line react-doctor/only-export-components -- context hook
export function useAccountPreferenceUpdater() {
  return useContext(AccountPreferenceUpdateContext)
}

// react-doctor-disable-next-line react-doctor/only-export-components -- context hook
export function useStartupTimeZoneCheck() {
  return useContext(StartupTimeZoneCheckContext)
}

export function SyncedAccountPreferencesProvider({
  value,
  children,
}: PropsWithChildren<{ value: AccountPreferences | null }>) {
  return (
    <AccountPreferencesContext.Provider value={value}>
      {children}
    </AccountPreferencesContext.Provider>
  )
}
