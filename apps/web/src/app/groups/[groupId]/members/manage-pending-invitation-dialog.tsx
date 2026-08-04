import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { AccountAvatar } from '@/components/account-avatar'
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
import { trpc } from '@/trpc/client'

import { GeneratedInviteLinkPanel } from './generated-invite-link-panel'
import { InviteFriendsTab } from './invite-friends-tab'
import {
  useRoleSelectItems,
  type PendingInvitation,
  type UpdatePendingInput,
} from './members-hooks'

type ManageFormValues = {
  delivery: 'EMAIL' | 'LINK'
  email: string
  temporaryName: string
  role: 'ADMIN' | 'MEMBER'
}

type MutationState = {
  mutateAsync: (input: UpdatePendingInput) => Promise<{
    invitation: PendingInvitation
    inviteUrl: string | null
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
    },
  })

  const delivery = form.watch('delivery')
  const emailValue = form.watch('email')
  const formState = form.formState

  const saving = updatePending.isPending

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
    })
    setInviteTab(invitation.type === 'LINK' ? 'link' : 'email')
    setSelectedFriendAccountId('')
    setLinkReady(null)
    setApiError(null)
  }, [open, invitation, form])

  const hasProfile = !!invitation?.recipientProfile
  const emailUnchanged =
    !!invitation &&
    delivery === 'EMAIL' &&
    emailValue.trim().toLowerCase() === invitation.email.toLowerCase()
  const profileLocked = hasProfile && emailUnchanged && delivery === 'EMAIL'

  const effectiveName = useMemo(() => {
    if (!invitation) return ''
    return (
      invitation.recipientProfile?.name ??
      invitation.temporaryName ??
      (invitation.type === 'LINK'
        ? t('invitations.link.fallbackLabel')
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
    try {
      const result = await updatePending.mutateAsync({
        invitationId: invitation.id,
        role: values.role,
        temporaryName: values.temporaryName.trim() || undefined,
        delivery:
          values.delivery === 'EMAIL'
            ? { type: 'EMAIL', email: values.email.trim() }
            : { type: 'LINK' },
      })
      if (result.inviteUrl) {
        setLinkReady({
          url: result.inviteUrl,
          expiresAt: result.invitation.expiresAt,
        })
      } else {
        toast({ description: t('manage.saved') })
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
                <p className="border-l-2 border-amber-500/50 pl-3 text-sm text-amber-900 dark:text-amber-200">
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
                              <FormLabel>{t('manage.emailLabel')}</FormLabel>
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
                                  field.onChange(value as 'ADMIN' | 'MEMBER')
                                }
                                disabled={saving}
                              >
                                <SelectTrigger aria-label={t('invite.role')}>
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
                      className="mr-2 h-4 w-4 animate-spin"
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
