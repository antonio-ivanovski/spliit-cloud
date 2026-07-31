/* oxlint-disable jsx-a11y/prefer-tag-over-role -- status role is retained for live-region compatibility with consumers. */
import { useMutation } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import {
  ArrowRight,
  Loader2,
  Mail,
  MailCheck,
  MailMinus,
  TriangleAlert,
} from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@/components/ui/card'
import { getApiBaseUrl } from '@/lib/api-url'
import { useCurrentAccount } from '@/lib/use-current-account'

import { NOTIFICATION_CATEGORY_METADATA } from './account/notification-category-metadata'

const apiBaseUrl = getApiBaseUrl()
const unsubscribeRoute = getRouteApi('/unsubscribe')

export default function UnsubscribePage() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Unsubscribe' })
  const { t: tNotifications } = useTranslation(undefined, {
    keyPrefix: 'AccountSettings.notifications',
  })
  const { data: account } = useCurrentAccount()
  const { token, preview } = unsubscribeRoute.useLoaderData()
  const unsubscribeMutation = useMutation({
    mutationKey: ['email-unsubscribe', token],
    mutationFn: async () => {
      if (!token) throw new Error('Missing unsubscribe token')
      const response = await fetch(
        `${apiBaseUrl}/email/unsubscribe?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'List-Unsubscribe=One-Click',
          credentials: 'include',
        },
      )
      if (!response.ok) throw new Error('Unsubscribe failed')
    },
  })

  useEffect(() => {
    unsubscribeMutation.reset()
  }, [token]) // oxlint-disable-line react-hooks/exhaustive-deps -- reset only when the route token changes.

  const category = preview?.category
  const metadata = category
    ? NOTIFICATION_CATEGORY_METADATA[category]
    : undefined

  const settingsHref = '/account/settings#notifications'
  const homeHref = account
    ? settingsHref
    : `/?redirect=${encodeURIComponent(settingsHref)}`

  if (!token || !metadata) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:py-20">
        <Card className="w-full max-w-xl overflow-hidden">
          <CardHeader className="gap-3 p-6 sm:p-8">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10">
              <TriangleAlert
                className="h-5 w-5 text-destructive"
                aria-hidden="true"
              />
            </div>
            <h1 className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
              {t('invalid.title')}
            </h1>
            <CardDescription className="max-w-md text-base leading-relaxed">
              {t('invalid.description')}
            </CardDescription>
          </CardHeader>
          <CardFooter className="border-t bg-muted/20 p-6 sm:px-8">
            <Button
              asChild
              className="h-auto min-h-10 min-w-0 py-2.5 text-center leading-5 whitespace-normal"
            >
              <Link href={homeHref}>{t('manageSettings')}</Link>
            </Button>
          </CardFooter>
        </Card>
      </main>
    )
  }

  if (unsubscribeMutation.isSuccess) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:py-20">
        <Card
          className="w-full max-w-xl overflow-hidden"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <CardHeader className="gap-3 p-6 sm:p-8">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
              <MailCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h1 className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
              {t('success.title')}
            </h1>
            <CardDescription className="max-w-md text-base leading-relaxed">
              {t('success.description', {
                category: tNotifications(metadata.titleKey),
              })}
            </CardDescription>
          </CardHeader>
          <CardFooter className="grid w-full grid-cols-1 gap-2 border-t bg-muted/20 p-6 sm:grid-cols-2 sm:px-8">
            <Button
              asChild
              variant="outline"
              className="h-auto min-h-10 min-w-0 py-2.5 text-center leading-5 whitespace-normal"
            >
              <Link href="/">{t('backHome')}</Link>
            </Button>
            <Button
              asChild
              className="h-auto min-h-10 min-w-0 py-2.5 text-center leading-5 whitespace-normal"
            >
              <Link href={homeHref}>{t('manageSettings')}</Link>
            </Button>
          </CardFooter>
        </Card>
      </main>
    )
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12 sm:py-20">
      <Card className="w-full max-w-xl overflow-hidden">
        <CardHeader className="gap-3 p-6 pb-5 sm:p-8 sm:pb-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <MailMinus className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
            {t('title')}
          </h1>
          <CardDescription className="max-w-md text-base leading-relaxed">
            {t('description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-6 pb-6 sm:px-8 sm:pb-8">
          <div className="rounded-xl border bg-muted/20 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-background">
                <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="leading-6 font-medium">
                  {tNotifications(metadata.titleKey)}
                </p>
                <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
                  {tNotifications(metadata.descriptionKey)}
                </p>
              </div>
            </div>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            {t('scope')}
          </p>
          {unsubscribeMutation.isError ? (
            <p
              className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              {t('error')}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-4 border-t bg-muted/20 p-6 sm:px-8">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              asChild
              size="lg"
              className="h-auto min-h-11 min-w-0 py-2.5 text-center leading-5 whitespace-normal"
            >
              <Link href="/">{t('cancel')}</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-auto min-h-11 min-w-0 border-destructive/40 py-2.5 text-center leading-5 whitespace-normal text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => unsubscribeMutation.mutate()}
              disabled={unsubscribeMutation.isPending}
            >
              {unsubscribeMutation.isPending ? (
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              {unsubscribeMutation.isPending ? t('submitting') : t('confirm')}
            </Button>
          </div>
          <Button
            asChild
            variant="link"
            className="h-auto min-w-0 self-center p-0 text-center leading-5 whitespace-normal"
          >
            <Link href={homeHref}>
              {t('manageSettings')}
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}
