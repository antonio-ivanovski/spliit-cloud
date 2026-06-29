import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link2, Share2, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import {
  emailFormSchema,
  formatDate,
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
  createMutation: {
    isPending: boolean
  }
  createLinkMutation: {
    isPending: boolean
  }
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
  const [generatedLink, setGeneratedLink] = useState<GeneratedLink | null>(null)
  const [inviteTab, setInviteTab] = useState<'email' | 'link'>('email')
  const [canShare, setCanShare] = useState(false)

  useEffect(() => {
    setCanShare(
      typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    )
  }, [])

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
          onValueChange={(value) => setInviteTab(value as 'email' | 'link')}
          className="flex flex-col gap-4"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="email">{t('invite.tab.email')}</TabsTrigger>
            <TabsTrigger value="link">{t('invite.tab.link')}</TabsTrigger>
          </TabsList>

          <TabsContent value="email" className="mt-0 flex flex-col gap-4">
            <p className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
              {t('invite.emailDescription')}
            </p>
            <Form {...form}>
              <form
                onSubmit={handleEmailSubmit}
                className="flex flex-col gap-3"
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('invite.email')}</FormLabel>
                      <FormControl>
                        <Input
                          className="text-base"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          spellCheck={false}
                          placeholder={t('invite.emailPlaceholder')}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="temporaryName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('invite.temporaryName')}</FormLabel>
                      <FormControl>
                        <Input
                          className="text-base"
                          type="text"
                          spellCheck={false}
                          autoComplete="off"
                          placeholder={t('invite.temporaryNamePlaceholder')}
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <FormItem className="space-y-0 sm:w-[10rem]">
                    <FormLabel className="sm:sr-only">
                      {t('invite.role')}
                    </FormLabel>
                    <FormControl>
                      <Select
                        value={roleValue}
                        onValueChange={(value) =>
                          setRoleValue(value as InvitableRole)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MEMBER">
                            {t('role.member')}
                          </SelectItem>
                          <SelectItem value="ADMIN">
                            {t('role.admin')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                  </FormItem>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || !email}
                  >
                    <UserPlus className="w-4 h-4 mr-2" />
                    {t('invite.send')}
                  </Button>
                </div>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="link" className="mt-0 flex flex-col gap-4">
            <p className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
              {t('invite.linkDescription')}
            </p>
            <Form {...linkForm}>
              <form onSubmit={handleLinkSubmit} className="flex flex-col gap-3">
                <FormField
                  control={linkForm.control}
                  name="temporaryName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('invite.temporaryName')}</FormLabel>
                      <FormControl>
                        <Input
                          className="text-base"
                          type="text"
                          spellCheck={false}
                          autoComplete="off"
                          placeholder={t('invite.temporaryNamePlaceholder')}
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <FormItem className="space-y-0 sm:w-[10rem]">
                    <FormLabel className="sm:sr-only">
                      {t('invite.role')}
                    </FormLabel>
                    <FormControl>
                      <Select
                        value={linkRoleValue}
                        onValueChange={(value) =>
                          setLinkRoleValue(value as InvitableRole)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MEMBER">
                            {t('role.member')}
                          </SelectItem>
                          <SelectItem value="ADMIN">
                            {t('role.admin')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                  </FormItem>
                  <Button type="submit" disabled={createLinkMutation.isPending}>
                    <Link2 className="w-4 h-4 mr-2" />
                    {createLinkMutation.isPending
                      ? t('invite.link.generating')
                      : generatedLink
                        ? t('invite.link.generateNew')
                        : t('invite.link.generate')}
                  </Button>
                </div>
              </form>
            </Form>

            {generatedLink && (
              <div
                className="mt-4 flex flex-col gap-3"
                data-testid="generated-invite-link"
              >
                <p className="text-sm text-muted-foreground">
                  {t('invite.link.intro', { groupName })}
                </p>
                <p className="border-l-2 border-amber-500/50 pl-3 text-sm text-amber-900 dark:text-amber-200">
                  {t('invite.link.singleUse')}
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={generatedLink.inviteUrl}
                    className="font-mono text-xs"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <CopyButton text={generatedLink.inviteUrl} />
                  {canShare && (
                    <Button
                      size="icon"
                      variant="secondary"
                      type="button"
                      onClick={handleShareLink}
                      aria-label={t('invite.link.share')}
                    >
                      <Share2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('invite.link.expiresOn', {
                    date: formatDate(generatedLink.expiresAt, 'en'),
                  })}
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
