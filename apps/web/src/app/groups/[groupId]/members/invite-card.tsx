import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { trpc } from '@/trpc/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { InviteContactsTab } from './invite-contacts-tab'
import { InviteEmailTab } from './invite-email-tab'
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
  const [contactRoleValue, setContactRoleValue] =
    useState<InvitableRole>('MEMBER')
  const [generatedLink, setGeneratedLink] = useState<GeneratedLink | null>(null)
  const [inviteTab, setInviteTab] = useState<'contacts' | 'email' | 'link'>(
    'email',
  )
  const [canShare, setCanShare] = useState(false)
  const [selectedContactAccountId, setSelectedContactAccountId] =
    useState<string>('')

  useEffect(() => {
    setCanShare(
      typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    )
  }, [])

  const contactsQuery = trpc.account.contacts.useQuery({ groupId })
  const contacts = contactsQuery.data?.contacts ?? []
  const selectedContact = contacts.find(
    (c) => c.accountId === selectedContactAccountId,
  )

  // Default to contacts tab when at least one non-member contact exists.
  const defaultTabApplied = useRef(false)
  useEffect(() => {
    if (defaultTabApplied.current) return
    if (!contactsQuery.isLoading && contacts.some((c) => !c.isMember)) {
      setInviteTab('contacts')
      defaultTabApplied.current = true
    }
  }, [contactsQuery.isLoading, contacts])

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

  const handleContactSubmit = () => {
    if (!selectedContact) return
    onInvite({
      email: selectedContact.email,
      role: contactRoleValue,
      temporaryName: selectedContact.name,
    })
    setSelectedContactAccountId('')
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
            setInviteTab(value as 'contacts' | 'email' | 'link')
          }
          className="flex flex-col gap-4"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="contacts">
              {t('invite.tab.contacts')}
            </TabsTrigger>
            <TabsTrigger value="email">{t('invite.tab.email')}</TabsTrigger>
            <TabsTrigger value="link">{t('invite.tab.link')}</TabsTrigger>
          </TabsList>

          <TabsContent value="contacts" className="mt-0 flex flex-col gap-4">
            <InviteContactsTab
              contacts={contacts}
              isLoading={contactsQuery.isLoading}
              selectedContactAccountId={selectedContactAccountId}
              onSelectContact={setSelectedContactAccountId}
              contactRoleValue={contactRoleValue}
              onRoleChange={setContactRoleValue}
              isPending={createMutation.isPending}
              onSubmit={handleContactSubmit}
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
