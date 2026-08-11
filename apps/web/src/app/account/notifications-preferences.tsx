/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/role-has-required-aria-props -- popover trigger exposes combobox semantics; popup IDs are managed by the UI primitive. */
import { Bell, Check, ChevronsUpDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useAccountPreferenceUpdater,
  useSyncedAccountPreferences,
} from '@/components/account-preferences-sync'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Command, CommandGroup, CommandItem } from '@/components/ui/command'
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import { isPlaceholderEmail } from '@/lib/account'
import { useMediaQuery } from '@/lib/hooks'
import { useCurrentAccount } from '@/lib/use-current-account'
import { usePushNotifications } from '@/lib/use-push-notifications'
import { cn } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { NotificationCategory } from '@spliit/domain/notifications'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NotificationChannel,
} from '@spliit/domain/notifications'

import {
  NOTIFICATION_SECTIONS,
  type NotificationRow,
} from './notification-category-metadata'
import {
  SettingsBadge,
  SettingsFieldRow,
  SettingsGroup,
  SettingsRow,
  SettingsSaving,
  SettingsSection,
  SettingsSectionSkeleton,
} from './settings-ui'

type Channel = NotificationChannel
type Category = NotificationCategory

type PreferenceCategory = {
  category: Category
  channels: Channel[] | null
  recommendedChannels: Channel[]
  inheritedChannels?: Channel[]
  effectiveChannels?: Channel[]
}

type PreferenceData = {
  hasExplicitPreferences: boolean
  hasPushTargets: boolean
  isPushConfigured: boolean
  categories: PreferenceCategory[]
}

const CHANNELS = NOTIFICATION_CHANNELS
const CATEGORIES = NOTIFICATION_CATEGORIES

function channelsForCategory(data: PreferenceData, category: Category) {
  const entry = data.categories.find((item) => item.category === category)
  if (!entry) return [NotificationChannel.EMAIL]
  return [
    ...(entry.channels ??
      entry.effectiveChannels ??
      entry.inheritedChannels ??
      entry.recommendedChannels),
  ]
}

function channelLabel(
  channels: Channel[],
  labels: Record<Channel, string>,
  offLabel: string,
) {
  if (channels.length === 0) return offLabel
  return CHANNELS.filter((channel) => channels.includes(channel))
    .map((channel) => labels[channel])
    .join(' + ')
}

function draftFromData(data: PreferenceData): Record<Category, Channel[]> {
  return Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      channelsForCategory(data, category),
    ]),
  ) as Record<Category, Channel[]>
}

type ChannelSelectorProps = {
  channels: Channel[]
  labels: Record<Channel, string>
  disabled?: boolean
  saving?: boolean
  onToggle: (channel: Channel) => void
  title: string
  emailDisabled?: boolean
  pushDisabled?: boolean
  offLabel: string
  savingLabel: string
  doneLabel: string
  /** Native id forwarded to the trigger button for label association. */
  id?: string
}

/** Small responsive multi-select matching the other selectors in the app. */
function ChannelSelector({
  channels,
  labels,
  disabled = false,
  saving = false,
  onToggle,
  title,
  emailDisabled = false,
  pushDisabled = false,
  offLabel,
  savingLabel,
  doneLabel,
  id,
}: ChannelSelectorProps) {
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const summary = channelLabel(channels, labels, offLabel)
  const content = (
    <Command>
      <CommandGroup>
        {CHANNELS.map((channel) => {
          const channelDisabled =
            channel === NotificationChannel.EMAIL ? emailDisabled : pushDisabled
          const checked = channels.includes(channel)
          return (
            <CommandItem
              key={channel}
              value={channel}
              disabled={channelDisabled || disabled || saving}
              onSelect={() => onToggle(channel)}
            >
              <Check
                className={cn(
                  'me-2 h-4 w-4 shrink-0',
                  checked ? 'opacity-100' : 'invisible',
                )}
              />
              <span>{labels[channel]}</span>
            </CommandItem>
          )
        })}
      </CommandGroup>
    </Command>
  )

  const trigger = (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={open}
      id={id}
      disabled={disabled || saving}
      className="h-9 w-full min-w-28 justify-between px-3 text-sm font-normal sm:w-auto sm:min-w-32"
    >
      <span className="truncate">{saving ? savingLabel : summary}</span>
      <ChevronsUpDown
        className="ms-2 h-4 w-4 shrink-0 opacity-50"
        aria-hidden="true"
      />
    </Button>
  )

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={trigger} />
        <PopoverContent className="w-48 p-0" align="end">
          {content}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger render={trigger} />
      <DrawerContent className="p-0">
        <DrawerHeader className="pb-2 text-start">
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <div className="px-1">{content}</div>
        <DrawerFooter className="border-t bg-background pt-3">
          <Button type="button" onClick={() => setOpen(false)}>
            {doneLabel}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export function NotificationsPreferences() {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AccountSettings.notifications',
  })
  const { t: tCommon } = useTranslation()
  const { toast } = useToast()
  const push = usePushNotifications()
  const { data: account } = useCurrentAccount()
  const accountPrefs = useSyncedAccountPreferences()
  const updater = useAccountPreferenceUpdater()
  const patchesDisabled = updater !== null && !updater.ready
  const notificationsEnabled = accountPrefs?.notificationsEnabled !== false
  const utils = trpc.useUtils()
  const preferences = trpc.notifications.preferences.get.useQuery(
    { accountId: account?.id ?? '' },
    { enabled: !!account },
  )
  const save = trpc.notifications.preferences.save.useMutation()
  const [draft, setDraft] = useState<Record<Category, Channel[]> | null>(null)
  const [pendingCategory, setPendingCategory] = useState<Category | null>(null)
  const initializedData = useRef<PreferenceData | undefined>(undefined)
  const emailDisabled = !account?.email || isPlaceholderEmail(account.email)

  useEffect(() => {
    if (!preferences.data || initializedData.current === preferences.data)
      return
    initializedData.current = preferences.data as PreferenceData
    const next = draftFromData(preferences.data as PreferenceData)
    if (emailDisabled) {
      for (const category of CATEGORIES) {
        next[category] = next[category].filter(
          (channel) => channel !== NotificationChannel.EMAIL,
        )
      }
    }
    setDraft(next)
  }, [emailDisabled, preferences.data])

  const channelLabels = useMemo(
    () =>
      Object.fromEntries(
        CHANNELS.map((channel) => [
          channel,
          t(channel === NotificationChannel.EMAIL ? 'email' : 'pushChannel'),
        ]),
      ) as Record<Channel, string>,
    [t],
  )
  const pushDisabled =
    !push.supported ||
    !push.configured ||
    push.iosHomeScreenRequired ||
    push.permission === 'denied'
  const noPushTargetWarning =
    push.supported &&
    push.configured &&
    !push.iosHomeScreenRequired &&
    !preferences.data?.hasPushTargets

  async function updateCategory(category: Category, channels: Channel[]) {
    if (!draft || pendingCategory) return
    const previous = draft[category]
    const savedChannels = channels
    setDraft((current) =>
      current ? { ...current, [category]: channels } : current,
    )
    setPendingCategory(category)
    try {
      await save.mutateAsync({
        preferences: [{ category, channels: savedChannels }],
      })
      await utils.notifications.preferences.get.invalidate({
        accountId: account?.id ?? '',
      })
      toast({ description: t('rowSaved') })
    } catch {
      setDraft((current) =>
        current ? { ...current, [category]: previous } : current,
      )
      toast({ description: t('saveError'), variant: 'destructive' })
    } finally {
      setPendingCategory(null)
    }
  }

  async function toggleChannel(category: Category, channel: Channel) {
    if (!draft) return
    const current = draft[category]
    const next = current.includes(channel)
      ? current.filter((candidate) => candidate !== channel)
      : [...current, channel]
    if (
      channel === NotificationChannel.PUSH &&
      !current.includes(channel) &&
      !push.enabled
    ) {
      setPendingCategory(category)
      try {
        await push.enable()
      } catch {
        setPendingCategory(null)
        toast({ description: t('error'), variant: 'destructive' })
        return
      }
      setPendingCategory(null)
    }
    await updateCategory(category, next)
  }

  async function handlePushToggle() {
    try {
      if (push.enabled) await push.disable()
      else await push.enable()
    } catch {
      toast({ description: t('error'), variant: 'destructive' })
    }
  }

  const sectionTitle = t('title')
  const sectionDescription = t('description')

  if (preferences.isError) {
    return (
      <SettingsSection
        id="notifications"
        title={sectionTitle}
        description={sectionDescription}
        icon={Bell}
      >
        <div className="px-4 pb-4 sm:px-6 sm:pb-6">
          <Alert variant="destructive" className="py-3">
            <AlertDescription className="text-sm">
              {t('loadError')}
            </AlertDescription>
          </Alert>
          <div className="pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void preferences.refetch()}
            >
              {t('retry')}
            </Button>
          </div>
        </div>
      </SettingsSection>
    )
  }

  if (preferences.isPending || !preferences.data || !draft) {
    return (
      <SettingsSectionSkeleton
        id="notifications"
        title={sectionTitle}
        description={sectionDescription}
        icon={Bell}
        rows={4}
      />
    )
  }

  const rows = NOTIFICATION_SECTIONS.map((section) => ({
    ...section,
    title: t(`sections.${section.id}` as 'sections.groups'),
    items: section.rows as readonly NotificationRow[],
  }))

  const comingSoonBadge = <SettingsBadge>{t('comingSoon')}</SettingsBadge>

  return (
    <SettingsSection
      id="notifications"
      title={sectionTitle}
      description={sectionDescription}
      icon={Bell}
      className="scroll-mt-6"
      status={
        <div className="flex items-center gap-3">
          {updater?.isUpdating ? <SettingsSaving label={t('saving')} /> : null}
          <Switch
            id="notifications-master-enabled"
            aria-label={t('masterLabel')}
            checked={notificationsEnabled}
            disabled={patchesDisabled}
            onCheckedChange={(value) =>
              void updater?.patchPreferences({ notificationsEnabled: value })
            }
          />
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {notificationsEnabled ? (
          <>
            {rows.map((section) => (
              <SettingsGroup
                key={section.id}
                id={`notification-group-${section.id}`}
                title={section.title}
              >
                <>
                  {section.items.map((row) => {
                    const channels = row.category ? draft[row.category] : []
                    const pushWarning =
                      row.category &&
                      channels.includes(NotificationChannel.PUSH) &&
                      !preferences.data.hasPushTargets
                    const description = (
                      <>
                        {t(row.descriptionKey)}
                        {pushWarning ? (
                          <span
                            className="mt-1 block text-xs text-amber-700 dark:text-amber-400"
                            aria-live="polite"
                          >
                            {t('pushMissingTarget')}
                          </span>
                        ) : null}
                      </>
                    )
                    const control =
                      row.category && !row.comingSoon ? (
                        <ChannelSelector
                          id={`notification-${row.id}`}
                          channels={channels}
                          labels={channelLabels}
                          title={t(row.titleKey)}
                          emailDisabled={emailDisabled}
                          pushDisabled={pushDisabled}
                          offLabel={t('off')}
                          savingLabel={t('saving')}
                          doneLabel={tCommon('Groups.Import.StepHeader.done')}
                          disabled={
                            pendingCategory !== null &&
                            pendingCategory !== row.category
                          }
                          saving={pendingCategory === row.category}
                          onToggle={(channel) =>
                            void toggleChannel(row.category!, channel)
                          }
                        />
                      ) : (
                        comingSoonBadge
                      )
                    if (row.category && !row.comingSoon) {
                      return (
                        <SettingsFieldRow
                          key={row.id}
                          id={`notification-${row.id}`}
                          label={t(row.titleKey)}
                          description={description}
                          control={control}
                        />
                      )
                    }
                    return (
                      <SettingsRow
                        key={row.id}
                        id={`notification-${row.id}`}
                        label={t(row.titleKey)}
                        description={description}
                        badges={control}
                        className="opacity-65"
                      />
                    )
                  })}
                </>
              </SettingsGroup>
            ))}

            {emailDisabled ? (
              <Alert variant="default" className="py-3">
                <AlertDescription className="text-sm">
                  {t('emailComingSoon')}
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : null}

        <SettingsGroup
          id="notification-group-device"
          title={t('push.deviceTitle')}
          description={t('push.deviceDescription')}
          beforeRows={
            <div className="flex flex-col gap-3">
              {noPushTargetWarning ? (
                <Alert
                  className="border-amber-500/50 bg-amber-50 py-3 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100"
                  aria-live="polite"
                >
                  <AlertDescription className="text-sm">
                    {t('push.noDevices')}
                  </AlertDescription>
                </Alert>
              ) : null}
              {!push.enabled &&
              push.supported &&
              push.configured &&
              !push.iosHomeScreenRequired &&
              push.permission !== 'denied' ? (
                <Alert variant="destructive" className="py-3">
                  <AlertDescription className="text-sm">
                    {t('push.deviceDisabled')}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          }
        >
          <SettingsRow
            id="notifications-device"
            label={push.enabled ? t('enabled') : t('disabled')}
            description={
              !push.supported
                ? t('unsupported')
                : !push.configured
                  ? t('notConfigured')
                  : push.iosHomeScreenRequired
                    ? t('iosInstall')
                    : push.permission === 'denied'
                      ? t('permissionDenied')
                      : undefined
            }
            control={
              push.supported &&
              push.configured &&
              !push.iosHomeScreenRequired &&
              push.permission !== 'denied' ? (
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  variant={push.enabled ? 'outline' : 'default'}
                  onClick={() => void handlePushToggle()}
                  disabled={push.isLoading || push.isUpdating}
                >
                  {push.isLoading || push.isUpdating ? (
                    <span
                      className="me-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-e-transparent"
                      aria-hidden="true"
                    />
                  ) : null}
                  {push.enabled ? t('disable') : t('enable')}
                </Button>
              ) : undefined
            }
          />
        </SettingsGroup>
      </div>
    </SettingsSection>
  )
}
