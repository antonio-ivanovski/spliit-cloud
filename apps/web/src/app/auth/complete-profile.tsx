'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslations } from '@/i18n/react'
import { useRouter, useSearchParams } from '@/lib/navigation'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'
import { Navigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Profile completion screen. Shown when an authenticated account has no
 * display name yet (e.g. right after a magic-link sign-up, which creates an
 * account with only an email).
 *
 * If the account already has a display name, the route redirects to the
 * original `redirect` target (defaulting to `/groups`). If the visitor is not
 * signed in, they are sent to `/auth/sign-in` with a redirect back here.
 */
export function CompleteProfilePage() {
  const t = useTranslations('CompleteProfile')
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect') ?? '/groups'
  const { data: account, isPending, refetch } = useCurrentAccount()

  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateProfile = trpc.account.updateProfile.useMutation()

  // If the account already has a usable display name, bounce to the target.
  const needsProfile =
    !!account && (!account.name || account.name === account.email)

  useEffect(() => {
    if (account && !needsProfile) {
      router.replace(redirectTo)
    }
  }, [account, needsProfile, redirectTo, router])

  if (isPending) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  if (!account) {
    const back = `/auth/complete-profile?redirect=${encodeURIComponent(redirectTo)}`
    return <Navigate to="/auth/sign-in" search={{ redirect: back }} replace />
  }

  if (!needsProfile) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('errors.nameRequired'))
      return
    }
    if (trimmed.length < 2) {
      setError(t('errors.nameTooShort'))
      return
    }
    setSubmitting(true)
    try {
      await updateProfile.mutateAsync({ name: trimmed })
      // Bust better-auth's cookie-cached session so `useCurrentAccount`
      // returns the updated name on the next read.
      await refetch({ query: { disableCookieCache: true } })
      router.replace(redirectTo)
    } catch {
      setError(t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {account.email && (
            <p className="text-xs text-muted-foreground text-center mb-4">
              {t('signedInAs', { email: account.email })}
            </p>
          )}
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-1.5">
              <Label htmlFor="profile-name">{t('nameLabel')}</Label>
              <Input
                id="profile-name"
                type="text"
                autoComplete="name"
                autoFocus
                placeholder={t('namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || !name.trim()}
            >
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {submitting ? t('saving') : t('submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
