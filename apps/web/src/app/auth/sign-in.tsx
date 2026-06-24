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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslations } from '@/i18n/react'
import { authClient } from '@/lib/auth'
import { useRouter, useSearchParams } from '@/lib/navigation'
import { ChevronDown, Loader2, Mail } from 'lucide-react'
import { useState } from 'react'

type Mode = 'sign-in' | 'sign-up'

export function SignInPage() {
  const t = useTranslations('Auth')
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect') ?? '/groups'
  const initialMode =
    searchParams.get('mode') === 'sign-up' ? 'sign-up' : 'sign-in'

  const webOrigin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'http://localhost:3000'
  const callbackURL = `${webOrigin}${redirectTo}`

  const [mode, setMode] = useState<Mode>(initialMode)

  const [magicEmail, setMagicEmail] = useState('')
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [magicSubmitting, setMagicSubmitting] = useState(false)
  const [magicError, setMagicError] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)

  const canSubmitEmailPassword = (() => {
    if (!email.trim()) return false
    if (mode === 'sign-in') return password.length > 0
    return password.length >= 8 && password === confirmPassword
  })()

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setMagicError(null)
    setMagicLinkSent(false)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'sign-in') {
        const result = await authClient.signIn.email({
          email: email.trim(),
          password,
        })
        if (result.error) {
          setError(t('errors.invalidCredentials'))
          return
        }
      } else {
        if (password.length < 8) {
          setError(t('errors.passwordTooShort'))
          return
        }
        if (password !== confirmPassword) {
          setError(t('passwordMismatch'))
          return
        }
        const result = await authClient.signUp.email({
          email: email.trim(),
          password,
          // Pass an empty name so better-auth creates the account; the
          // `RequireAuth` guard will detect the missing display name and
          // redirect the user to `/auth/complete-profile`, matching the
          // magic-link sign-up flow.
          name: '',
        })
        if (result.error) {
          setError(
            result.error.message?.includes('already')
              ? t('errors.invalidCredentials')
              : t('errors.generic'),
          )
          return
        }
      }
      router.replace(redirectTo)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleMagicLink(event: React.FormEvent) {
    event.preventDefault()
    setMagicError(null)
    if (!magicEmail.trim()) {
      setMagicError(t('errors.emailRequired'))
      return
    }
    setMagicSubmitting(true)
    try {
      const result = await authClient.signIn.magicLink({
        email: magicEmail.trim(),
        callbackURL,
      })
      if (result.error) {
        setMagicError(t('errors.magicLinkFailed'))
        return
      }
      setMagicLinkSent(true)
    } finally {
      setMagicSubmitting(false)
    }
  }

  async function handleGoogle() {
    setError(null)
    await authClient.signIn.social({
      provider: 'google',
      callbackURL,
    })
  }

  const googleEnabled =
    import.meta.env.VITE_ENABLE_GOOGLE_OAUTH === 'true' ||
    import.meta.env.VITE_ENABLE_GOOGLE_OAUTH === '1'

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl">
            {mode === 'sign-in' ? t('title') : t('signUpTitle')}
          </CardTitle>
          <CardDescription>
            {mode === 'sign-in' ? t('subtitle') : t('signUpSubtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            {googleEnabled && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleGoogle}
                disabled={magicSubmitting || submitting}
              >
                <GoogleIcon className="w-4 h-4 mr-2" />
                {t('signInWithGoogle')}
              </Button>
            )}

            {magicLinkSent ? (
              <div className="rounded-lg border bg-muted/40 px-4 py-5 text-center flex flex-col gap-3">
                <Mail className="w-5 h-5 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {t('magicLinkSent')}
                </p>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="mx-auto -my-1 h-auto py-0"
                  onClick={() => {
                    setMagicLinkSent(false)
                    setMagicEmail('')
                    setMagicError(null)
                  }}
                >
                  {t('useDifferentEmail')}
                </Button>
              </div>
            ) : (
              <form className="flex flex-col gap-2" onSubmit={handleMagicLink}>
                <div className="grid gap-1.5">
                  <Label htmlFor="magic-email">{t('magicLinkEmail')}</Label>
                  <Input
                    id="magic-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={magicEmail}
                    onChange={(e) => setMagicEmail(e.target.value)}
                    required
                  />
                </div>
                {magicError && (
                  <p className="text-sm text-destructive" role="alert">
                    {magicError}
                  </p>
                )}
                <Button
                  type="submit"
                  variant="default"
                  className="w-full"
                  disabled={magicSubmitting || !magicEmail.trim()}
                >
                  {magicSubmitting && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  <Mail className="w-4 h-4 mr-2" />
                  {t('sendMagicLink')}
                </Button>
              </form>
            )}
          </div>

          <Collapsible
            open={passwordOpen}
            onOpenChange={setPasswordOpen}
            className="flex flex-col gap-3"
          >
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mx-auto -my-2"
              >
                <ChevronDown
                  className={`w-4 h-4 mr-2 transition-transform ${
                    passwordOpen ? 'rotate-180' : ''
                  }`}
                />
                {passwordOpen ? t('hidePasswordForm') : t('usePasswordInstead')}
              </Button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <form
                className="flex flex-col gap-3 pt-1"
                onSubmit={handleSubmit}
              >
                <p className="text-sm text-muted-foreground text-center">
                  {mode === 'sign-in'
                    ? t('passwordFormDescription')
                    : t('passwordFormDescriptionSignUp')}
                </p>
                <div className="grid gap-1.5">
                  <Label htmlFor="auth-email">{t('email')}</Label>
                  <Input
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="auth-password">{t('password')}</Label>
                  <Input
                    id="auth-password"
                    type="password"
                    autoComplete={
                      mode === 'sign-in' ? 'current-password' : 'new-password'
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {mode === 'sign-up' && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="auth-confirm-password">
                      {t('confirmPassword')}
                    </Label>
                    <Input
                      id="auth-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </div>
                )}
                {error && (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full"
                  disabled={submitting || !canSubmitEmailPassword}
                >
                  {submitting && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  {mode === 'sign-in'
                    ? t('signInWithPassword')
                    : t('signUpWithPassword')}
                </Button>
              </form>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
        <div className="flex flex-col gap-3 px-6 pb-6">
          <div className="text-sm text-muted-foreground text-center w-full">
            {mode === 'sign-in' ? t('noAccount') : t('haveAccount')}{' '}
            <Button
              type="button"
              variant="link"
              className="px-0"
              onClick={() =>
                switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
              }
            >
              {mode === 'sign-in' ? t('createAccount') : t('signIn')}
            </Button>
          </div>
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link href="/">{t('back')}</Link>
          </Button>
        </div>
      </Card>
    </main>
  )
}

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  )
}
