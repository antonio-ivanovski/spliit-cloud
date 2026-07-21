import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { useToast } from '@/components/ui/use-toast'
import { useMediaQuery } from '@/lib/hooks'
import { useCurrentAccount } from '@/lib/use-current-account'
import { usePushNotifications } from '@/lib/use-push-notifications'
import { cn } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'
import { Bell, Check, ChevronsUpDown, Smartphone } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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

type Row = {
  id: string
  category?: Category
  titleKey:
    | 'rows.addedToGroup.title'
    | 'rows.addedAsFriend.title'
    | 'rows.newExpense.title'
    | 'rows.expenseChanged.title'
    | 'rows.newComment.title'
    | 'rows.weeklySummary.title'
    | 'rows.cloudNews.title'
  descriptionKey:
    | 'rows.addedToGroup.description'
    | 'rows.addedAsFriend.description'
    | 'rows.newExpense.description'
    | 'rows.expenseChanged.description'
    | 'rows.newComment.description'
    | 'rows.weeklySummary.description'
    | 'rows.cloudNews.description'
  comingSoon?: boolean
}

const CHANNELS = NOTIFICATION_CHANNELS
const CATEGORIES = NOTIFICATION_CATEGORIES

const GROUP_ROWS: Row[] = [
  {
    id: 'added-to-group',
    category: NotificationCategory.GROUP_INVITE_RECEIVED,
    titleKey: 'rows.addedToGroup.title',
    descriptionKey: 'rows.addedToGroup.description',
  },
  {
    id: 'added-as-friend',
    category: NotificationCategory.FRIEND_ADDED,
    titleKey: 'rows.addedAsFriend.title',
    descriptionKey: 'rows.addedAsFriend.description',
  },
]

const EXPENSE_ROWS: Row[] = [
  {
    id: 'new-expense',
    category: NotificationCategory.EXPENSE_CREATED,
    titleKey: 'rows.newExpense.title',
    descriptionKey: 'rows.newExpense.description',
  },
  {
    id: 'expense-changed',
    category: NotificationCategory.EXPENSE_CHANGED,
    titleKey: 'rows.expenseChanged.title',
    descriptionKey: 'rows.expenseChanged.description',
  },
  {
    id: 'new-comment',
    category: NotificationCategory.EXPENSE_COMMENT,
    titleKey: 'rows.newComment.title',
    descriptionKey: 'rows.newComment.description',
    comingSoon: true,
  },
]

const SUMMARY_ROWS: Row[] = [
  {
    id: 'weekly-summary',
    category: NotificationCategory.WEEKLY_SUMMARY,
    titleKey: 'rows.weeklySummary.title',
    descriptionKey: 'rows.weeklySummary.description',
    comingSoon: true,
  },
  {
    id: 'cloud-news',
    category: NotificationCategory.PRODUCT_UPDATES,
    titleKey: 'rows.cloudNews.title',
    descriptionKey: 'rows.cloudNews.description',
    comingSoon: true,
  },
]

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
                  'mr-2 h-4 w-4 shrink-0',
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
      aria-expanded={open}
      disabled={disabled || saving}
      className="h-9 min-w-28 justify-between px-3 text-sm font-normal sm:min-w-32"
    >
      <span className="truncate">{saving ? savingLabel : summary}</span>
      <ChevronsUpDown
        className="ml-2 h-4 w-4 shrink-0 opacity-50"
        aria-hidden="true"
      />
    </Button>
  )

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent className="w-48 p-0" align="end">
          {content}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
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
  const utils = trpc.useUtils()
  const preferences = trpc.notifications.preferences.get.useQuery(
    { accountId: account?.id ?? '' },
    { enabled: !!account },
  )
  const save = trpc.notifications.preferences.save.useMutation()
  const [draft, setDraft] = useState<Record<Category, Channel[]> | null>(null)
  const [pendingCategory, setPendingCategory] = useState<Category | null>(null)
  const initializedData = useRef<PreferenceData | undefined>(undefined)
  const emailDisabled =
    !account?.email || account.email.toLowerCase().includes('placeholder.local')

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
    // Keep explicit selections explicit. In particular, Email-only is an
    // intentional onboarding choice and must not look like an unconfigured
    // account on another device.
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

  if (preferences.isError) {
    return (
      <Card className="mobile-surface">
        <CardHeader>
          <CardTitle className="text-lg">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-destructive" role="alert">
            {t('loadError')}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void preferences.refetch()}
          >
            {t('retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (preferences.isPending || !preferences.data || !draft) {
    return (
      <Card className="mobile-surface">
        <CardHeader>
          <CardTitle className="text-lg">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="h-24 animate-pulse rounded-md bg-muted"
            aria-label={t('loading')}
          />
        </CardContent>
      </Card>
    )
  }

  const rows = [
    { id: 'groups', title: t('sections.groups'), items: GROUP_ROWS },
    { id: 'expenses', title: t('sections.expenses'), items: EXPENSE_ROWS },
    { id: 'summaries', title: t('sections.summaries'), items: SUMMARY_ROWS },
  ]

  return (
    <Card id="notifications" className="mobile-surface scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bell className="h-5 w-5" aria-hidden="true" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-7">
        {rows.map((section) => (
          <section
            key={section.id}
            aria-labelledby={`notification-${section.id}-heading`}
          >
            <h3
              id={`notification-${section.id}-heading`}
              className="mb-2 text-sm font-semibold text-foreground"
            >
              {section.title}
            </h3>
            <div className="divide-y rounded-lg border">
              {section.items.map((row) => {
                const channels = row.category ? draft[row.category] : []
                const pushWarning =
                  row.category &&
                  channels.includes(NotificationChannel.PUSH) &&
                  !preferences.data.hasPushTargets
                return (
                  <div
                    key={row.id}
                    className={cn(
                      'flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4',
                      row.comingSoon && 'opacity-65',
                    )}
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{t(row.titleKey)}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {t(row.descriptionKey)}
                      </p>
                      {row.comingSoon ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('comingSoon')}
                        </p>
                      ) : null}
                      {pushWarning ? (
                        <p
                          className="mt-1 text-xs text-amber-700 dark:text-amber-400"
                          role="status"
                        >
                          {t('pushMissingTarget')}
                        </p>
                      ) : null}
                    </div>
                    {row.category && !row.comingSoon ? (
                      <ChannelSelector
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
                      <span className="shrink-0 text-xs font-medium text-muted-foreground">
                        {t('comingSoon')}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}

        {emailDisabled ? (
          <Alert variant="default" className="py-3">
            <AlertDescription className="text-sm">
              {t('emailComingSoon')}
            </AlertDescription>
          </Alert>
        ) : null}

        <section
          aria-labelledby="notification-device-heading"
          className="flex flex-col gap-3 border-t pt-5"
        >
          <div>
            <h3
              id="notification-device-heading"
              className="flex items-center gap-2 font-medium"
            >
              <Smartphone className="h-4 w-4" aria-hidden="true" />
              {t('push.deviceTitle')}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('push.deviceDescription')}
            </p>
          </div>
          {noPushTargetWarning ? (
            <Alert
              className="border-amber-500/50 bg-amber-50 py-3 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100"
              role="status"
            >
              <AlertDescription className="text-sm">
                {t('push.noDevices')}
              </AlertDescription>
            </Alert>
          ) : null}
          {!push.supported ? (
            <p className="text-sm text-muted-foreground">{t('unsupported')}</p>
          ) : !push.configured ? (
            <p className="text-sm text-muted-foreground">
              {t('notConfigured')}
            </p>
          ) : push.iosHomeScreenRequired ? (
            <p className="text-sm text-muted-foreground">{t('iosInstall')}</p>
          ) : push.permission === 'denied' ? (
            <p className="text-sm text-muted-foreground">
              {t('permissionDenied')}
            </p>
          ) : (
            <>
              {!push.enabled ? (
                <Alert variant="destructive" className="py-3">
                  <AlertDescription className="text-sm">
                    {t('push.deviceDisabled')}
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {push.enabled ? t('enabled') : t('disabled')}
                </p>
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  variant={push.enabled ? 'outline' : 'default'}
                  onClick={() => void handlePushToggle()}
                  disabled={push.isLoading || push.isUpdating}
                >
                  {push.isLoading || push.isUpdating ? (
                    <span
                      className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
                      aria-hidden="true"
                    />
                  ) : null}
                  {push.enabled ? t('disable') : t('enable')}
                </Button>
              </div>
            </>
          )}
        </section>
      </CardContent>
    </Card>
  )
}
