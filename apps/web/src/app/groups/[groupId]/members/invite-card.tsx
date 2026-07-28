import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { trpc } from '@/trpc/client'

import { InviteEmailTab } from './invite-email-tab'
import { InviteFriendsTab } from './invite-friends-tab'
import { InviteLinkTab } from './invite-link-tab'
import {
  emailFormSchema,
  type EmailFormValues,
  type GeneratedLink,
  type InvitableRole,
  type LinkFormValues,
} from './members-hooks'

export function InviteCard({
  groupId,
  groupName,
  createMutation,
  createLinkMutation,
  onInvite,
  onGenerateLink,
}: {
  groupId: string
  groupName: string
  createMutation: { isPending: boolean }
  createLinkMutation: { isPending: boolean }
  onInvite: (values: {
    email: string
    role: InvitableRole
    temporaryName?: string
  }) => void
  onGenerateLink: (values: {
    role: InvitableRole
    temporaryName?: string
  }) => Promise<{
    inviteUrl: string
    temporaryName: string | null
    role: InvitableRole
    expiresAt: Date | string
  } | void>
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const [roleValue, setRoleValue] = useState<InvitableRole>('MEMBER')
  const [linkRoleValue, setLinkRoleValue] = useState<InvitableRole>('MEMBER')
  const [friendRoleValue, setFriendRoleValue] =
    useState<InvitableRole>('MEMBER')
  const [generatedLink, setGeneratedLink] = useState<GeneratedLink | null>(null)
  const [inviteTab, setInviteTab] = useState<'friends' | 'email' | 'link'>(
    'email',
  )
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

  const email = form.watch('email')

  const handleEmailSubmit = form.handleSubmit(async (values) => {
    const temporaryName = values.temporaryName?.trim()
    onInvite({
      email: values.email,
      role: roleValue,
      temporaryName: temporaryName ? temporaryName : undefined,
    })
    form.reset({ email: '', temporaryName: '' })
  })

  const handleLinkSubmit = linkForm.handleSubmit(async (values) => {
    const temporaryName = values.temporaryName?.trim()
    const data = await onGenerateLink({
      role: linkRoleValue,
      temporaryName: temporaryName ? temporaryName : undefined,
    })
    if (data) {
      setGeneratedLink({
        inviteUrl: data.inviteUrl,
        temporaryName: data.temporaryName,
        role: data.role,
        expiresAt: data.expiresAt,
      })
    }
    linkForm.reset({ temporaryName: '' })
  })

  const handleFriendSubmit = () => {
    if (!selectedFriend) return
    onInvite({
      email: selectedFriend.email,
      role: friendRoleValue,
      temporaryName: selectedFriend.name,
    })
    setSelectedFriendAccountId('')
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
          onValueChange={(value) =>
            setInviteTab(value as 'friends' | 'email' | 'link')
          }
          className="flex flex-col gap-4"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="friends">{t('invite.tab.friends')}</TabsTrigger>
            <TabsTrigger value="email">{t('invite.tab.email')}</TabsTrigger>
            <TabsTrigger value="link">{t('invite.tab.link')}</TabsTrigger>
          </TabsList>

          <TabsContent value="friends" className="mt-0 flex flex-col gap-4">
            <InviteFriendsTab
              friends={friends ?? []}
              isLoading={friendsQuery.isLoading}
              selectedFriendAccountId={selectedFriendAccountId}
              onSelectFriend={setSelectedFriendAccountId}
              friendRoleValue={friendRoleValue}
              onRoleChange={setFriendRoleValue}
              isPending={createMutation.isPending}
              onSubmit={handleFriendSubmit}
            />
          </TabsContent>

          <TabsContent value="email" className="mt-0 flex flex-col gap-4">
            <InviteEmailTab
              form={form}
              onSubmit={handleEmailSubmit}
              roleValue={roleValue}
              onRoleChange={setRoleValue}
              isPending={createMutation.isPending}
              email={email}
            />
          </TabsContent>

          <TabsContent value="link" className="mt-0 flex flex-col gap-4">
            <InviteLinkTab
              linkForm={linkForm}
              onSubmit={handleLinkSubmit}
              linkRoleValue={linkRoleValue}
              onRoleChange={setLinkRoleValue}
              isPending={createLinkMutation.isPending}
              generatedLink={generatedLink}
              canShare={canShare}
              groupName={groupName}
              onShare={handleShareLink}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
