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
import { useLocation } from '@tanstack/react-router'
import { Loader2, Mail } from 'lucide-react'
import { useState } from 'react'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Forgot-password screen. The user enters their email; we ask the API to
 * mail them a reset link and then show the same "check your inbox" copy
 * regardless of whether the email exists, so the screen cannot be used to
 * enumerate accounts. better-auth's `/request-password-reset` already does
 * equivalent work for unknown emails (generates an ID and queries a dummy
 * token) so the response shape is identical.
 */
export function ForgotPasswordPage() {
  const t = useTranslations('ForgotPassword')
  const searchParams = new URLSearchParams(
    useLocation({ select: (location) => location.searchStr }),
  )

  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const [emailSent, setEmailSent] = useState(false)

  const requestReset = useMutation({
    retry: false,
    mutationFn: async (vars: { email: string }) => {
      // better-auth requires `redirectTo` (the web URL the user lands on
      // after clicking the email link). The API's `/reset-password/:token`
      // GET handler validates the token and 302s to this URL with the
      // validated token attached as `?token=...`.
      const resetPageUrl = `${window.location.origin}/auth/reset-password`
      const result = await authClient.requestPasswordReset({
        email: vars.email.trim(),
        redirectTo: resetPageUrl,
      })
      if (result.error) {
        throw new Error(t('errors.sendFailed'))
      }
    },
    onSuccess() {
      setEmailSent(true)
    },
  })

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!email.trim()) return
    requestReset.mutate({ email })
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl">{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {emailSent ? (
            <div className="rounded-lg border bg-muted/40 px-4 py-5 text-center flex flex-col gap-3">
              <Mail className="w-5 h-5 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t('emailSent')}</p>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="mx-auto -my-1 h-auto py-0"
                onClick={() => {
                  setEmailSent(false)
                  setEmail('')
                  requestReset.reset()
                }}
              >
                {t('tryAgain')}
              </Button>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="grid gap-1.5">
                <Label htmlFor="forgot-email">{t('emailLabel')}</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {requestReset.isError && (
                <p className="text-sm text-destructive" role="alert">
                  {getErrorMessage(requestReset.error)}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={requestReset.isPending || !email.trim()}
              >
                {requestReset.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {t('submit')}
              </Button>
            </form>
          )}
        </CardContent>
        <div className="flex flex-col gap-3 px-6 pb-6">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link
              href={`/${
                email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''
              }`}
            >
              {t('backToSignIn')}
            </Link>
          </Button>
        </div>
      </Card>
    </main>
  )
}
