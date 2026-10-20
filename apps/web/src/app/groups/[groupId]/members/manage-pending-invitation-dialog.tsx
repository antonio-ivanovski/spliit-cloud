import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { AccountAvatar } from '@/components/account-avatar'
import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { detectDeviceTimeZone } from '@/lib/account-preferences'
import { usePwaUpdateBlocker } from '@/lib/pwa-update-blockers'
import { trpc } from '@/trpc/client'

import { GeneratedInviteLinkPanel } from './generated-invite-link-panel'
import { InviteFriendsTab } from './invite-friends-tab'
import {
  SHARED_LINK_CUSTOM_PRESET,
  SHARED_LINK_LABEL_MAX_LENGTH,
  SHARED_LINK_MAX_USES_LIMIT,
  SHARED_LINK_MIN_USES,
  formatDateTime,
  joinLimitPresetFor,
  useRoleSelectItems,
  type PendingInvitation,
  type SharedLinkExpiry,
  type UpdatePendingInput,
} from './members-hooks'
import { ExpiryPicker, JoinLimitPicker } from './shared-link-limit-pickers'

type ManageFormValues = {
  delivery: 'EMAIL' | 'LINK'
  email: string
  temporaryName: string
  role: 'ADMIN' | 'MEMBER'
  sharedLabel: string
  /** Picker preset for the join cap (`other` reveals the custom input). */
  sharedJoinLimitPreset: string
  sharedMaxUses: number | null
  /** Picker preset for the expiry (`keep` leaves the row untouched). */
  sharedExpiryPreset: string
  /**
   * New expiry duration from save time; `null` = never expires, `undefined` =
   * keep the row's current expiry (the `keep` preset).
   */
  sharedExpiresIn?: SharedLinkExpiry | undefined
}

type MutationState = {
  mutateAsync: (input: UpdatePendingInput) => Promise<{
    invitation: PendingInvitation
    inviteUrl: string | null
    emailDelivered: boolean
  }>
  isPending: boolean
}

export function ManagePendingInvitationDialog({
  invitation,
  groupName,
  isAdmin,
  updatePending,
  finalFocusRef,
  onOpenChange,
}: {
  invitation: PendingInvitation | null
  groupName: string
  isAdmin: boolean
  updatePending: MutationState
  finalFocusRef?: React.RefObject<HTMLButtonElement | null>
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const { toast } = useToast()
  const open = invitation !== null
  const roleSelectItems = useRoleSelectItems()

  const [linkReady, setLinkReady] = useState<{
    url: string
    expiresAt: Date | string | null
  } | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [inviteTab, setInviteTab] = useState<'friends' | 'email' | 'link'>(
    'email',
  )
  const [selectedFriendAccountId, setSelectedFriendAccountId] =
    useState<string>('')

  const emailInputRef = useRef<HTMLInputElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const lastInvitationIdRef = useRef<string | null>(null)

  const manageFormSchema = useMemo(
    () =>
      z
        .object({
          delivery: z.enum(['EMAIL', 'LINK']),
          email: z.string().trim(),
          temporaryName: z.string().trim().max(120),
          role: z.enum(['ADMIN', 'MEMBER']),
          sharedLabel: z.string().trim().max(SHARED_LINK_LABEL_MAX_LENGTH),
          sharedJoinLimitPreset: z.string(),
          sharedMaxUses: z.number().int().nullable(),
          sharedExpiryPreset: z.string(),
          sharedExpiresIn: z
            .object({
              amount: z.number().int(),
              unit: z.enum(['hours', 'days', 'weeks']),
            })
            .nullable()
            .optional(),
        })
        .superRefine((values, ctx) => {
          if (
            values.delivery === 'EMAIL' &&
            !z.email().safeParse(values.email).success
          ) {
            ctx.addIssue({
              code: 'custom',
              path: ['email'],
              message: t('manage.emailInvalid'),
            })
          }
        }),
    [t],
  )

  const form = useForm<ManageFormValues>({
    resolver: zodResolver(manageFormSchema),
    defaultValues: {
      delivery: 'EMAIL',
      email: '',
      temporaryName: '',
      role: 'MEMBER',
      sharedLabel: '',
      sharedJoinLimitPreset: 'unlimited',
      sharedMaxUses: null,
      sharedExpiryPreset: 'keep',
      sharedExpiresIn: undefined,
    },
  })

  const delivery = form.watch('delivery')
  const emailValue = form.watch('email')
  const formState = form.formState

  const saving = updatePending.isPending

  usePwaUpdateBlocker(
    Boolean(open && invitation && formState.isDirty),
    'manage-invitation-edits',
  )

  useEffect(() => {
    if (!open || !invitation) {
      lastInvitationIdRef.current = null
      return
    }
    if (lastInvitationIdRef.current === invitation.id) return
    lastInvitationIdRef.current = invitation.id
    form.reset({
      delivery: invitation.type === 'LINK' ? 'LINK' : 'EMAIL',
      email: invitation.type === 'EMAIL' ? invitation.email : '',
      temporaryName: invitation.temporaryName ?? '',
      role: invitation.role,
      sharedLabel: invitation.label ?? '',
      sharedJoinLimitPreset: String(joinLimitPresetFor(invitation.maxUses)),
      sharedMaxUses: invitation.maxUses,
      // Expiry always resets to "keep current": the row stores an absolute
      // `expiresAt`, not the original duration, so the dialog cannot
      // pre-select a preset — any new choice submits a fresh duration.
      sharedExpiryPreset: 'keep',
      sharedExpiresIn: undefined,
    })
    setInviteTab(invitation.type === 'LINK' ? 'link' : 'email')
    setSelectedFriendAccountId('')
    setLinkReady(null)
    setApiError(null)
  }, [open, invitation, form])

  // Dismiss a previous save error as soon as any field is edited. The
  // subscription fires only on form value changes, so setting apiError after
  // a failed save does not immediately clear itself.
  useEffect(() => {
    // oxlint-disable-next-line react/incompatible-library -- subscription-style watch is the documented RHF change listener.
    const subscription = form.watch(() => {
      setApiError((prev) => (prev === null ? prev : null))
    })
    return () => subscription.unsubscribe()
  }, [form])

  const hasProfile = !!invitation?.recipientProfile
  const emailUnchanged =
    !!invitation &&
    delivery === 'EMAIL' &&
    emailValue.trim().toLowerCase() === invitation.email.toLowerCase()
  const profileLocked = hasProfile && emailUnchanged && delivery === 'EMAIL'

  const isSharedRow = !!invitation?.isShared

  const effectiveName = useMemo(() => {
    if (!invitation) return ''
    return (
      invitation.recipientProfile?.name ??
      invitation.temporaryName ??
      (invitation.isShared
        ? invitation.label?.trim() || t('invitations.shared.type')
        : invitation.type === 'LINK'
          ? invitation.isMultiUse
            ? t('invitations.qr.fallbackLabel')
            : t('invitations.link.fallbackLabel')
          : invitation.email)
    )
  }, [invitation, t])

  const emailChanged =
    !!invitation &&
    delivery === 'EMAIL' &&
    emailValue.trim().toLowerCase() !== invitation.email.toLowerCase()
  const switchingToEmail =
    !!invitation && delivery === 'EMAIL' && invitation.type === 'LINK'
  const switchingToLink =
    !!invitation && delivery === 'LINK' && invitation.type === 'EMAIL'
  const destinationWillChange = emailChanged || switchingToEmail

  const saveLabel = switchingToLink
    ? t('manage.switchToLinkGenerate')
    : switchingToEmail
      ? t('manage.switchToEmailSend')
      : emailChanged
        ? t('manage.updateSend')
        : t('manage.saveChanges')

  const friendsQuery = trpc.account.friends.useQuery(
    { groupId: invitation?.groupId ?? '' },
    { enabled: open },
  )
  const friends = friendsQuery.data?.friends ?? []

  function handleTabChange(value: string) {
    const tab = value as 'friends' | 'email' | 'link'
    setInviteTab(tab)
    if (apiError) setApiError(null)
    // The tab is the delivery selector: friends/email mean EMAIL
    // delivery, link means LINK. Marking the field dirty is what
    // enables the footer Save button (mirrors the old radio toggle).
    form.setValue('delivery', tab === 'link' ? 'LINK' : 'EMAIL', {
      shouldDirty: true,
    })
  }

  function handleSelectFriend(accountId: string) {
    const friend = friends.find((f) => f.accountId === accountId)
    setSelectedFriendAccountId(accountId)
    if (apiError) setApiError(null)
    if (!friend) return
    // Selecting a friend targets the form at their email + profile
    // name and enables the footer Save button.
    form.setValue('delivery', 'EMAIL', { shouldDirty: true })
    form.setValue('email', friend.email, { shouldDirty: true })
    form.setValue('temporaryName', friend.name, { shouldDirty: true })
  }

  function handleClose() {
    onOpenChange(false)
  }

  async function handleSave(values: ManageFormValues) {
    if (!invitation) return
    setApiError(null)
    if (isSharedRow) {
      if (
        values.sharedJoinLimitPreset === SHARED_LINK_CUSTOM_PRESET &&
        values.sharedMaxUses == null
      ) {
        setApiError(t('invite.link.invalidJoinLimit'))
        return
      }
      if (values.sharedMaxUses != null) {
        const maxUses = values.sharedMaxUses
        if (
          !Number.isInteger(maxUses) ||
          maxUses < SHARED_LINK_MIN_USES ||
          maxUses > SHARED_LINK_MAX_USES_LIMIT
        ) {
          setApiError(t('invite.link.invalidJoinLimit'))
          return
        }
      }
      if (
        values.sharedExpiryPreset === SHARED_LINK_CUSTOM_PRESET &&
        values.sharedExpiresIn == null
      ) {
        setApiError(t('invite.link.invalidExpiry'))
        return
      }
      if (values.sharedExpiresIn != null) {
        const amount = values.sharedExpiresIn.amount
        if (amount == null || !Number.isInteger(amount) || amount < 1) {
          setApiError(t('invite.link.invalidExpiry'))
          return
        }
      }
    }
    try {
      const result = await updatePending.mutateAsync({
        invitationId: invitation.id,
        role: values.role,
        temporaryName: values.temporaryName.trim() || undefined,
        delivery:
          values.delivery === 'EMAIL'
            ? { type: 'EMAIL', email: values.email.trim() }
            : { type: 'LINK' },
        // `undefined` means "no change" per field; the backend leaves
        // untouched fields alone. The expiry picker defaults to the `keep`
        // preset (`undefined`), so an untouched expiry never clears — only
        // an explicit Never (`null`) or a fresh duration does.
        shared: isSharedRow
          ? {
              label: values.sharedLabel.trim() || null,
              maxUses: values.sharedMaxUses,
              expiresIn: values.sharedExpiresIn,
            }
          : undefined,
      })
      if (result.inviteUrl) {
        setLinkReady({
          url: result.inviteUrl,
          expiresAt: result.invitation.expiresAt,
        })
      } else {
        toast({
          description:
            !result.emailDelivered && destinationWillChange
              ? t('manage.savedWithoutEmail')
              : t('manage.saved'),
        })
        handleClose()
      }
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err))
    }
  }

  const avatarAccount = invitation?.recipientProfile ?? {
    id: invitation?.id ?? 'pending',
    name: effectiveName,
    image: null,
  }

  // Shared links: the link itself IS the credential, so the manage dialog
  // edits label/limits instead of delivery. Copy lives on the pending row.
  const sharedJoinedSummary = isSharedRow
    ? invitation!.maxUses != null
      ? t('invitations.shared.joinedOf', {
          count: invitation!.useCount,
          max: invitation!.maxUses,
        })
      : t('invitations.shared.joinedUnlimited', {
          count: invitation!.useCount,
        })
    : null

  const canShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function handleShare() {
    if (!linkReady || !canShare) return
    try {
      await navigator.share({
        title: t('invite.link.shareTitle', { groupName }),
        text: t('invite.link.shareText', {
          groupName,
          inviteUrl: linkReady.url,
        }),
      })
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.warn('[manage-invitation] share failed:', err)
      }
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      {open && invitation && (
        <ResponsiveDialogContent
          className="max-w-lg"
          initialFocus={() => {
            if (inviteTab === 'link') return nameInputRef.current
            if (inviteTab === 'email') return emailInputRef.current
            return null
          }}
          finalFocus={finalFocusRef}
        >
          {linkReady ? (
            <>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>
                  {t('manage.linkReadyTitle')}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  {t('manage.linkReadyDescription')}
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <ResponsiveDialogBody className="flex flex-col gap-3">
                <GeneratedInviteLinkPanel
                  inviteUrl={linkReady.url}
                  expiresAt={linkReady.expiresAt ?? new Date()}
                  onShare={handleShare}
                  canShare={canShare}
                />
                <p className="border-s-2 border-amber-500/50 ps-3 text-sm text-amber-900 dark:text-amber-200">
                  {t('manage.linkReadyWarning')}
                </p>
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter>
                <Button onClick={handleClose}>{t('manage.done')}</Button>
              </ResponsiveDialogFooter>
            </>
          ) : (
            <>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>
                  {t('manage.title')}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  {t('manage.description', { name: effectiveName })}
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <Form {...form}>
                <form
                  id="manage-invitation-form"
                  noValidate
                  onSubmit={form.handleSubmit(handleSave)}
                >
                  <ResponsiveDialogBody className="flex flex-col gap-4">
                    {apiError && (
                      <p
                        className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                        role="alert"
                      >
                        {apiError}
                      </p>
                    )}

                    <div className="flex items-center gap-3">
                      <AccountAvatar
                        account={avatarAccount}
                        size="lg"
                        className="shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{effectiveName}</p>
                        {invitation.type === 'LINK'
                          ? effectiveName !==
                              t('invitations.link.anyoneWithLink') && (
                              <p className="truncate text-xs text-muted-foreground">
                                {t('invitations.link.anyoneWithLink')}
                              </p>
                            )
                          : effectiveName !== invitation.email && (
                              <p className="truncate text-xs text-muted-foreground">
                                {invitation.email}
                              </p>
                            )}
                      </div>
                    </div>

                    {isSharedRow ? (
                      <SharedLinkLimitFields
                        form={form}
                        invitation={invitation}
                        saving={saving}
                        joinedSummary={sharedJoinedSummary ?? ''}
                      />
                    ) : (
                      <>
                        <Tabs
                          value={inviteTab}
                          onValueChange={handleTabChange}
                          className="flex flex-col gap-3"
                        >
                          <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="friends">
                              {t('invite.tab.friends')}
                            </TabsTrigger>
                            <TabsTrigger value="email">
                              {t('invite.tab.email')}
                            </TabsTrigger>
                            <TabsTrigger value="link">
                              {t('invite.tab.link')}
                            </TabsTrigger>
                          </TabsList>

                          <TabsContent value="friends" className="mt-0">
                            <InviteFriendsTab
                              friends={friends}
                              isLoading={friendsQuery.isLoading}
                              selectedFriendAccountId={selectedFriendAccountId}
                              onSelectFriend={handleSelectFriend}
                              excludeFromPendingEmail={
                                invitation.type === 'EMAIL'
                                  ? invitation.email
                                  : undefined
                              }
                            />
                            {formState.errors.email && (
                              <p
                                role="alert"
                                className="mt-2 text-sm text-destructive"
                              >
                                {formState.errors.email.message}
                              </p>
                            )}
                          </TabsContent>

                          <TabsContent
                            value="email"
                            className="mt-0 flex flex-col gap-3"
                          >
                            <FormField
                              control={form.control}
                              name="email"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>
                                    {t('manage.emailLabel')}
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      className="text-base"
                                      type="email"
                                      inputMode="email"
                                      autoComplete="email"
                                      spellCheck={false}
                                      disabled={saving}
                                      placeholder={t('manage.emailPlaceholder')}
                                      {...field}
                                      ref={(el) => {
                                        emailInputRef.current = el
                                      }}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </TabsContent>

                          <TabsContent value="link" className="mt-0">
                            <p
                              className="text-sm text-muted-foreground"
                              role="note"
                            >
                              {invitation.type === 'LINK'
                                ? t('manage.linkNotShown')
                                : t('manage.switchToLinkNote')}
                            </p>
                          </TabsContent>
                        </Tabs>

                        {delivery === 'EMAIL' &&
                          destinationWillChange &&
                          !formState.errors.email && (
                            <p
                              className="text-sm text-muted-foreground"
                              role="note"
                            >
                              {t('manage.emailChangeWarning')}
                            </p>
                          )}

                        <FormField
                          control={form.control}
                          name="temporaryName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t('manage.nameLabel')}</FormLabel>
                              {profileLocked ? (
                                <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-3 py-2">
                                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                    {invitation.recipientProfile?.name ?? ''}
                                  </span>
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {t('manage.profileNameNote')}
                                  </span>
                                </div>
                              ) : (
                                <FormControl>
                                  <Input
                                    className="text-base"
                                    type="text"
                                    spellCheck={false}
                                    autoComplete="off"
                                    disabled={saving}
                                    maxLength={120}
                                    placeholder={t(
                                      'invite.temporaryNamePlaceholder',
                                    )}
                                    {...field}
                                    ref={(el) => {
                                      nameInputRef.current = el
                                    }}
                                  />
                                </FormControl>
                              )}
                            </FormItem>
                          )}
                        />

                        {isAdmin && (
                          <FormField
                            control={form.control}
                            name="role"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('invite.role')}</FormLabel>
                                <FormControl>
                                  <Select
                                    value={field.value}
                                    items={roleSelectItems}
                                    onValueChange={(value) =>
                                      field.onChange(
                                        value as 'ADMIN' | 'MEMBER',
                                      )
                                    }
                                    disabled={saving}
                                  >
                                    <SelectTrigger
                                      aria-label={t('invite.role')}
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {roleSelectItems.map((item) => (
                                        <SelectItem
                                          key={item.value}
                                          value={item.value}
                                        >
                                          {item.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        )}
                      </>
                    )}
                  </ResponsiveDialogBody>
                </form>
              </Form>
              <ResponsiveDialogFooter>
                <Button variant="ghost" onClick={handleClose} disabled={saving}>
                  {t('manage.cancel')}
                </Button>
                <Button
                  type="submit"
                  form="manage-invitation-form"
                  disabled={saving || !formState.isDirty}
                  className="min-w-40"
                >
                  {saving && (
                    <Loader2
                      className="me-2 h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {saveLabel}
                </Button>
              </ResponsiveDialogFooter>
            </>
          )}
        </ResponsiveDialogContent>
      )}
    </ResponsiveDialog>
  )
}

/**
 * Limit/label editor for a shared link row. Delivery, name, and role do not
 * apply to shared links (no named recipient, always MEMBER), so the manage
 * dialog swaps its whole body for these fields.
 */
function computeNewExpiryDate(
  expiresInValue: SharedLinkExpiry | undefined,
): Date | null {
  // Module-level (not a component or handler) so the clock read stays
  // outside compiled render scope.
  if (!expiresInValue) return null
  return new Date(
    Date.now() +
      expiresInValue.amount *
        (expiresInValue.unit === 'hours'
          ? 60 * 60 * 1000
          : expiresInValue.unit === 'days'
            ? 24 * 60 * 60 * 1000
            : 7 * 24 * 60 * 60 * 1000),
  )
}
function SharedLinkLimitFields({
  form,
  invitation,
  saving,
  joinedSummary,
}: {
  form: UseFormReturn<ManageFormValues>
  invitation: PendingInvitation
  saving: boolean
  joinedSummary: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const locale = useLocale()
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'
  const maxUsesValue = form.watch('sharedMaxUses')
  const expiresInValue = form.watch('sharedExpiresIn')

  // Warn when the edited cap would end the link immediately: the cap is at
  // or below current usage while the link is still live.
  const endsNow =
    maxUsesValue != null &&
    invitation.endedReason === null &&
    maxUsesValue <= invitation.useCount

  // The new absolute expiry, computed from a save-now duration so the
  // reviewer sees the resulting date (not just "3 days"). Only shown when
  // a fresh duration is picked — `keep` leaves the row untouched and
  // `never` needs no date.
  const newExpiryDate = computeNewExpiryDate(expiresInValue)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground" role="note">
        {invitation.expiresAt
          ? t('invitations.shared.expiresWithJoins', {
              date: formatDateTime(
                invitation.expiresAt,
                locale,
                accountTimeZone,
              ),
              joins: joinedSummary,
            })
          : `${joinedSummary} · ${t('invite.link.neverExpires')}`}
        {invitation.endedReason === 'full' &&
          ` · ${t('invitations.shared.full')}`}
        {invitation.endedReason === 'expired' &&
          ` · ${t('invitations.link.expired')}`}
      </p>
      <FormField
        control={form.control}
        name="sharedLabel"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('manage.sharedLabelLabel')}</FormLabel>
            <FormControl>
              <Input
                className="text-base"
                type="text"
                spellCheck={false}
                autoComplete="off"
                disabled={saving}
                maxLength={SHARED_LINK_LABEL_MAX_LENGTH}
                placeholder={t('invite.link.labelPlaceholder')}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="sharedMaxUses"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <JoinLimitPicker
                  preset={form.watch('sharedJoinLimitPreset')}
                  onPresetChange={(preset) =>
                    form.setValue('sharedJoinLimitPreset', preset, {
                      shouldDirty: true,
                    })
                  }
                  value={field.value}
                  onChange={(value) =>
                    field.onChange(value, { shouldDirty: true })
                  }
                  disabled={saving}
                  label={t('invite.link.joinLimitLabel')}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="sharedExpiresIn"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <ExpiryPicker
                  preset={form.watch('sharedExpiryPreset')}
                  onPresetChange={(preset) =>
                    form.setValue('sharedExpiryPreset', preset, {
                      shouldDirty: true,
                    })
                  }
                  value={field.value}
                  onChange={(value) =>
                    field.onChange(value, { shouldDirty: true })
                  }
                  disabled={saving}
                  label={t('invite.link.expiryLabel')}
                  keepOption={{ label: t('manage.sharedKeepExpiry') }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      {newExpiryDate && (
        <p className="text-sm text-muted-foreground" role="note">
          {t('manage.sharedExpiresOn', {
            date: formatDateTime(newExpiryDate, locale, accountTimeZone),
          })}
        </p>
      )}
      {endsNow && (
        <p
          className="rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
          role="note"
        >
          {t('manage.sharedEndsNow', { count: invitation.useCount })}
        </p>
      )}
      <p className="text-sm text-muted-foreground" role="note">
        {t('invite.link.memberOnlyNote')}
      </p>
    </div>
  )
}
