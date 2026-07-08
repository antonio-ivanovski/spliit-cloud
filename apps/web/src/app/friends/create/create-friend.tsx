import { CurrencySelector } from '@/components/currency-selector'
import Link from '@/components/link'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
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
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { getCurrency, useCurrencies } from '@/lib/currency'
import { useRouter } from '@/lib/navigation'
import { trpc } from '@/trpc/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { friendFormSchema, type FriendFormValues } from '@spliit/domain/schemas'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

type CreateFriendResponse = {
  groupId: string
  existed?: boolean
  inviteUrl?: string
  invitationId?: string
}

type PeerTab = 'friends' | 'email' | 'link'

export function CreateFriend() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Friends' })
  const { t: tGroupForm } = useTranslation(undefined, {
    keyPrefix: 'GroupForm',
  })
  const { t: tCommon } = useTranslation(undefined, { keyPrefix: 'Header' })
  const router = useRouter()
  const utils = trpc.useUtils()
  const { toast } = useToast()
  const [peerTab, setPeerTab] = useState<PeerTab>('friends')

  const friendsQuery = trpc.account.friends.useQuery()
  const friends = friendsQuery.data?.friends ?? []
  const hasInvitableFriend = friends.length > 0

  const { mutateAsync: createFriend } = trpc.friends.create.useMutation({
    onSuccess: () => {
      utils.account.groups.invalidate()
      utils.account.friends.invalidate()
    },
  })

  const defaultCurrencyCode =
    import.meta.env.VITE_DEFAULT_CURRENCY_CODE || 'USD'
  const defaultCurrency = getCurrency(defaultCurrencyCode) ?? {
    code: 'USD',
    symbol: '$',
    rounding: 0,
    decimal_digits: 2,
  }

  const form = useForm<FriendFormValues>({
    resolver: zodResolver(friendFormSchema),
    defaultValues: {
      peerAccountId: undefined,
      peerEmail: undefined,
      temporaryName: undefined,
      useLink: undefined,
      currency: defaultCurrency.symbol ?? '',
      currencyCode: defaultCurrency.code,
      information: '',
    },
  })

  const currencies = useCurrencies(
    tGroupForm('CurrencyCodeField.customOption'),
    form.watch('currency') || undefined,
  )

  const handleSubmit = form.handleSubmit(async (values) => {
    const payload: FriendFormValues = {
      ...values,
      peerAccountId: peerTab === 'friends' ? values.peerAccountId : undefined,
      peerEmail: peerTab === 'email' ? values.peerEmail : undefined,
      useLink: peerTab === 'link' ? true : undefined,
    }

    let result: CreateFriendResponse
    try {
      result = (await createFriend({
        friendFormValues: payload,
      })) as CreateFriendResponse
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : 'Could not create friend ledger',
        variant: 'destructive',
      })
      return
    }

    if (!result) return

    if (result.existed) {
      router.push({
        to: '/groups/$groupId',
        params: { groupId: result.groupId },
      })
      return
    }

    if (result.inviteUrl) {
      router.push({
        to: '/groups/$groupId',
        params: { groupId: result.groupId },
        search: { friendLinkInvite: result.inviteUrl },
      })
      return
    }

    if (result.invitationId) {
      toast({ description: t('inviteSent') })
      router.push({
        to: '/groups/$groupId',
        params: { groupId: result.groupId },
      })
      return
    }

    router.push({
      to: '/groups/$groupId/expenses',
      params: { groupId: result.groupId },
    })
  })

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.replace({ href: '/' })
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2"
          onClick={handleBack}
          title={tCommon('back')}
          aria-label={tCommon('back')}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        {t('title')}
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('linkHelp')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Tabs
                value={peerTab}
                onValueChange={(value) => {
                  setPeerTab(value as PeerTab)
                  if (value === 'link') {
                    form.setValue('useLink', true, { shouldDirty: true })
                  }
                }}
                className="flex flex-col gap-4"
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="friends">
                    {t('peerFriendsTab')}
                  </TabsTrigger>
                  <TabsTrigger value="email">{t('peerEmailTab')}</TabsTrigger>
                  <TabsTrigger value="link">{t('peerLinkTab')}</TabsTrigger>
                </TabsList>

                <TabsContent
                  value="friends"
                  className="mt-0 flex flex-col gap-3"
                >
                  {friendsQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">…</p>
                  ) : !hasInvitableFriend ? (
                    <p className="text-sm text-muted-foreground">
                      {t('friendsEmpty')}
                    </p>
                  ) : (
                    <FormField
                      control={form.control}
                      name="peerAccountId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('peerFriendsTab')}</FormLabel>
                          <Select
                            value={field.value ?? ''}
                            onValueChange={(value) => {
                              field.onChange(value || undefined)
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={t('peerFriendsTab')} />
                            </SelectTrigger>
                            <SelectContent>
                              {friends.map((f) => (
                                <SelectItem
                                  key={f.accountId}
                                  value={f.accountId}
                                >
                                  <span className="flex items-center gap-2">
                                    <span>{f.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {f.email}
                                    </span>
                                    {f.hasFriendLedger && (
                                      <span className="text-xs text-muted-foreground">
                                        ({t('alreadyHasLedger')})
                                      </span>
                                    )}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </TabsContent>

                <TabsContent value="email" className="mt-0 flex flex-col gap-3">
                  <FormField
                    control={form.control}
                    name="peerEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('emailLabel')}</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            className="text-base"
                            autoComplete="email"
                            spellCheck={false}
                            placeholder="friend@example.com"
                            {...field}
                            value={field.value ?? ''}
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
                        <FormLabel>{t('temporaryNameLabel')}</FormLabel>
                        <FormControl>
                          <Input
                            type="text"
                            className="text-base"
                            spellCheck={false}
                            autoComplete="off"
                            {...field}
                            value={field.value ?? ''}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('temporaryNameHelp')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>

                <TabsContent value="link" className="mt-0 flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    {t('linkHelp')}
                  </p>
                </TabsContent>
              </Tabs>

              <FormField
                control={form.control}
                name="currencyCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {tGroupForm('CurrencyCodeField.label')}
                    </FormLabel>
                    <CurrencySelector
                      currencies={currencies}
                      defaultValue={form.watch(field.name) ?? ''}
                      onValueChange={(newCurrency) => {
                        field.onChange(newCurrency)
                        const currency =
                          getCurrency(newCurrency) ??
                          ({
                            code: '',
                            symbol: '',
                            rounding: 0,
                            decimal_digits: 2,
                          } as const)
                        if (
                          currency.code.length ||
                          form.getFieldState('currency').isTouched
                        )
                          form.setValue('currency', currency.symbol, {
                            shouldValidate: true,
                            shouldTouch: true,
                            shouldDirty: true,
                          })
                      }}
                      isLoading={false}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem hidden={!!form.watch('currencyCode')?.length}>
                    <FormLabel>{tGroupForm('CurrencyField.label')}</FormLabel>
                    <FormControl>
                      <Input className="text-base" maxLength={5} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="information"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('infoLabel')}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        className="text-base"
                        placeholder={t('infoPlaceholder')}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-2 justify-end">
                <Button asChild variant="ghost">
                  <Link href="/">{tCommon('back')}</Link>
                </Button>
                <SubmitButton loadingContent={t('title')}>
                  {t('title')}
                </SubmitButton>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </>
  )
}
