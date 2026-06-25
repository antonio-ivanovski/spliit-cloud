'use client'

import Link from '@/components/link'
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
import { authClient } from '@/lib/auth'
import { useMutation } from '@tanstack/react-query'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'

/**
 * Reset-password screen. Reached via the link emailed by the
 * forgot-password flow: better-auth's `/reset-password/:token` GET handler
 * validates the token and 302s to `/auth/reset-password?token=...`. If the
 * token is missing, expired, or already consumed, better-auth appends
 * `?error=INVALID_TOKEN` instead.
 *
 * On success we navigate to `/auth/sign-in` — the user re-authenticates
 * with the new password. We deliberately do not auto-sign-in: better-auth
 * is configured with `revokeSessionsOnPasswordReset: true` for security,
 * so any existing session is already invalid.
 */
export function ResetPasswordPage() {
  const t = useTranslations('ResetPassword')
  const navigate = useNavigate()
  const searchParams = new URLSearchParams(
    useLocation({ select: (location) => location.searchStr }),
  )
  const token = searchParams.get('token')
  const hasInvalidToken =
    !token || searchParams.get('error') === 'INVALID_TOKEN'

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const resetPassword = useMutation({
    retry: false,
    mutationFn: async (vars: { newPassword: string; token: string }) => {
      const result = await authClient.resetPassword({
        newPassword: vars.newPassword,
        token: vars.token,
      })
      if (result.error) {
        if (result.error.code === 'INVALID_TOKEN') {
          throw new Error(t('errors.invalidToken'))
        }
        throw new Error(t('errors.generic'))
      }
    },
    onSuccess() {
      setDone(true)
    },
  })

  const errorMessage =
    clientError ??
    (resetPassword.isError
      ? resetPassword.error instanceof Error
        ? resetPassword.error.message
        : String(resetPassword.error)
      : null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!token) return
    setClientError(null)
    if (password.length < 8) {
      setClientError(t('errors.passwordTooShort'))
      return
    }
    if (password !== confirmPassword) {
      setClientError(t('passwordMismatch'))
      return
    }
    await resetPassword.mutateAsync({ newPassword: password, token })
  }

  if (hasInvalidToken) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <Card className="w-full max-w-sm">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="text-2xl">{t('invalidTokenTitle')}</CardTitle>
            <CardDescription>{t('invalidTokenDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button asChild className="w-full">
              <Link href="/auth/forgot-password">{t('requestNewLink')}</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="w-full">
              <Link href="/auth/sign-in">{t('backToSignIn')}</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (done) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <Card className="w-full max-w-sm">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="text-2xl">{t('success')}</CardTitle>
            <CardDescription>{t('successDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              onClick={() => navigate({ href: '/auth/sign-in', replace: true })}
            >
              {t('goToSignIn')}
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  const canSubmit = password.length >= 8 && password === confirmPassword

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl">{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-1.5">
              <Label htmlFor="reset-password">{t('newPassword')}</Label>
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="reset-confirm-password">
                {t('confirmPassword')}
              </Label>
              <Input
                id="reset-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            {errorMessage && (
              <p className="text-sm text-destructive" role="alert">
                {errorMessage}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={resetPassword.isPending || !canSubmit}
            >
              {resetPassword.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              {resetPassword.isPending ? t('submitting') : t('submit')}
            </Button>
          </form>
        </CardContent>
        <div className="flex flex-col gap-3 px-6 pb-6">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link href="/auth/sign-in">{t('backToSignIn')}</Link>
          </Button>
        </div>
      </Card>
    </main>
  )
}
