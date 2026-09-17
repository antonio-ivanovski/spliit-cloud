import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePwaUpdateBlocker } from '@/lib/pwa-update-blockers'
import { trpc } from '@/trpc/client'

import { AddUnlinkedParticipantTab } from './add-unlinked-participant-tab'
import { InviteEmailTab } from './invite-email-tab'
import { InviteFriendsTab } from './invite-friends-tab'
import { InviteLinkTab } from './invite-link-tab'
import { InviteQrTab } from './invite-qr-tab'
import {
  emailFormSchema,
  type EmailFormValues,
  type GeneratedLink,
  type InvitableRole,
  type InviteTab,
  type LinkFormValues,
  type QrSession,
  type UnlinkedParticipantFormValues,
} from './members-hooks'

export function InviteCard({
  groupId,
  groupName,
  canInviteAdmin,
  createMutation,
  createLinkMutation,
  createParticipantMutation,
  onInvite,
  onGenerateLink,
  onAddParticipant,
  qrSession,
  onQrSessionChange,
  showQrTabRequest,
}: {
  groupId: string
  groupName: string
  canInviteAdmin: boolean
  createMutation: { isPending: boolean }
  createLinkMutation: { isPending: boolean }
  createParticipantMutation: { isPending: boolean }
  onInvite: (values: {
    email: string
    role: InvitableRole
    temporaryName?: string
  }) => Promise<boolean>
  onGenerateLink: (values: {
    role: InvitableRole
    temporaryName?: string
  }) => Promise<{
    inviteUrl: string
    temporaryName: string | null
    role: InvitableRole
    expiresAt: Date | string
  } | void>
  onAddParticipant: (values: UnlinkedParticipantFormValues) => Promise<boolean>
  /**
   * The live QR session, owned by the members page (shared with the pending
   * list so an Expire there also clears the displayed code). Lifted out of the
   * tab because tab switches unmount inactive panels.
   */
  qrSession: QrSession | null
  onQrSessionChange: (session: QrSession | null) => void
  /**
   * External request to switch to the QR tab (e.g. "View QR" from a pending
   * invitation row). Consumed via an incrementing counter so repeated requests
   * always take effect.
   */
  showQrTabRequest?: number
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const [roleValue, setRoleValue] = useState<InvitableRole>('MEMBER')
  const [linkRoleValue, setLinkRoleValue] = useState<InvitableRole>('MEMBER')
  const [friendRoleValue, setFriendRoleValue] =
    useState<InvitableRole>('MEMBER')
  const [generatedLink, setGeneratedLink] = useState<GeneratedLink | null>(null)
  const [inviteTab, setInviteTab] = useState<InviteTab>('email')
  // External "View QR" requests land on the QR tab.
  const lastShowQrRequest = useRef(showQrTabRequest)
  useEffect(() => {
    if (
      showQrTabRequest !== undefined &&
      showQrTabRequest !== lastShowQrRequest.current
    ) {
      lastShowQrRequest.current = showQrTabRequest
      setInviteTab('qr')
    }
  }, [showQrTabRequest])
  const canShare = useSyncExternalStore(
    () => () => {},
    () =>
      typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    () => false,
  )
  const [selectedFriendAccountId, setSelectedFriendAccountId] =
    useState<string>('')

  const friendsQuery = trpc.account.friends.useQuery({ groupId })
  const friends = friendsQuery.data?.friends
  const selectedFriend = (friends ?? []).find(
    (f) => f.accountId === selectedFriendAccountId,
  )

  // Default to friends tab when at least one non-member friend exists.
  const defaultTabApplied = useRef(false)
  useEffect(() => {
    if (defaultTabApplied.current) return
    if (!friendsQuery.isLoading && (friends ?? []).some((f) => !f.isMember)) {
      setInviteTab('friends')
      defaultTabApplied.current = true
    }
  }, [friendsQuery.isLoading, friends])

  const form = useForm<EmailFormValues>({
    resolver: zodResolver(emailFormSchema),
    defaultValues: { email: '', temporaryName: '' },
  })

  const linkForm = useForm<LinkFormValues>({
    defaultValues: { temporaryName: '' },
  })

  // oxlint-disable-next-line react/incompatible-library -- react-hook-form watch reads during render by design.
  const email = form.watch('email')
  const temporaryName = form.watch('temporaryName')
  const linkTemporaryName = linkForm.watch('temporaryName')
  // Typed but unsubmitted invites would be lost. The global mutation guard
  // covers submitted invites.
  usePwaUpdateBlocker(
    Boolean(
      email?.trim() || temporaryName?.trim() || linkTemporaryName?.trim(),
    ) || selectedFriendAccountId !== '',
    'invite-card-edits',
  )
  const effectiveRoleValue = canInviteAdmin ? roleValue : 'MEMBER'
  const effectiveLinkRoleValue = canInviteAdmin ? linkRoleValue : 'MEMBER'
  const effectiveFriendRoleValue = canInviteAdmin ? friendRoleValue : 'MEMBER'
  const inviteTabItems = [
    { value: 'friends', label: t('invite.tab.friends') },
    { value: 'email', label: t('invite.tab.email') },
    { value: 'link', label: t('invite.tab.link') },
    { value: 'qr', label: t('invite.tab.qr') },
    { value: 'unlinked', label: t('invite.tab.unlinked') },
  ] as const

  const handleEmailSubmit = form.handleSubmit(async (values) => {
    const temporaryName = values.temporaryName?.trim()
    try {
      const created = await onInvite({
        email: values.email,
        role: effectiveRoleValue,
        temporaryName: temporaryName ? temporaryName : undefined,
      })
      if (created) form.reset({ email: '', temporaryName: '' })
    } catch {
      // Mutation callbacks already surface the failure; keep the form draft.
    }
  })

  const handleLinkSubmit = linkForm.handleSubmit(async (values) => {
    const temporaryName = values.temporaryName?.trim()
    try {
      const data = await onGenerateLink({
        role: effectiveLinkRoleValue,
        temporaryName: temporaryName ? temporaryName : undefined,
      })
      if (data) {
        setGeneratedLink({
          inviteUrl: data.inviteUrl,
          temporaryName: data.temporaryName,
          role: data.role,
          expiresAt: data.expiresAt,
        })
        linkForm.reset({ temporaryName: '' })
      }
    } catch {
      // Mutation callbacks already surface the failure; keep the form draft.
    }
  })

  const handleFriendSubmit = async () => {
    if (!selectedFriend) return
    try {
      const created = await onInvite({
        email: selectedFriend.email,
        role: effectiveFriendRoleValue,
        temporaryName: selectedFriend.name,
      })
      if (created) setSelectedFriendAccountId('')
    } catch {
      // Mutation callbacks already surface the failure; keep the selection.
    }
  }

  async function handleShareLink() {
    if (!generatedLink || !canShare) return
    try {
      await navigator.share({
        title: t('invite.link.shareTitle', { groupName }),
        text: t('invite.link.shareText', {
          groupName,
          inviteUrl: generatedLink.inviteUrl,
        }),
      })
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.warn('[invite] share failed:', err)
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('invite.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs
          value={inviteTab}
          onValueChange={(value) => setInviteTab(value as InviteTab)}
          className="flex flex-col gap-4"
        >
          <Select
            value={inviteTab}
            items={inviteTabItems}
            onValueChange={(value) => {
              if (value) {
                setInviteTab(value as InviteTab)
              }
            }}
          >
            <SelectTrigger className="sm:hidden" aria-label={t('invite.title')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {inviteTabItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <TabsList className="hidden w-full grid-cols-2 sm:grid sm:grid-cols-5">
            <TabsTrigger value="friends">{t('invite.tab.friends')}</TabsTrigger>
            <TabsTrigger value="email">{t('invite.tab.email')}</TabsTrigger>
            <TabsTrigger value="link">{t('invite.tab.link')}</TabsTrigger>
            <TabsTrigger value="qr">{t('invite.tab.qr')}</TabsTrigger>
            <TabsTrigger value="unlinked">
              {t('invite.tab.unlinked')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="friends" className="mt-0 flex flex-col gap-4">
            <InviteFriendsTab
              friends={friends ?? []}
              isLoading={friendsQuery.isLoading}
              selectedFriendAccountId={selectedFriendAccountId}
              onSelectFriend={setSelectedFriendAccountId}
              friendRoleValue={effectiveFriendRoleValue}
              canInviteAdmin={canInviteAdmin}
              onRoleChange={setFriendRoleValue}
              isPending={createMutation.isPending}
              onSubmit={() => void handleFriendSubmit()}
            />
          </TabsContent>

          <TabsContent value="email" className="mt-0 flex flex-col gap-4">
            <InviteEmailTab
              form={form}
              onSubmit={handleEmailSubmit}
              roleValue={effectiveRoleValue}
              canInviteAdmin={canInviteAdmin}
              onRoleChange={setRoleValue}
              isPending={createMutation.isPending}
              email={email}
            />
          </TabsContent>

          <TabsContent value="link" className="mt-0 flex flex-col gap-4">
            <InviteLinkTab
              linkForm={linkForm}
              onSubmit={handleLinkSubmit}
              linkRoleValue={effectiveLinkRoleValue}
              canInviteAdmin={canInviteAdmin}
              onRoleChange={setLinkRoleValue}
              isPending={createLinkMutation.isPending}
              generatedLink={generatedLink}
              canShare={canShare}
              groupName={groupName}
              onShare={handleShareLink}
            />
          </TabsContent>

          <TabsContent value="qr" className="mt-0 flex flex-col gap-4">
            <InviteQrTab
              groupId={groupId}
              session={qrSession}
              onSessionChange={onQrSessionChange}
            />
          </TabsContent>

          <TabsContent value="unlinked" className="mt-0 flex flex-col gap-4">
            <AddUnlinkedParticipantTab
              isPending={createParticipantMutation.isPending}
              onSubmit={onAddParticipant}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
