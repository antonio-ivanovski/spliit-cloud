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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { authClient } from '@/lib/auth'
import { cn } from '@/lib/utils'
import {
  getPasswordRequirements,
  isStrongPassword,
  type PasswordRequirementId,
} from '@spliit/domain/password'
import { useMutation } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Check, Circle, Github, Loader2, Mail } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const homeRouteApi = getRouteApi('/')

type Mode = 'sign-in' | 'sign-up'
type EmailVariant = 'magic-link' | 'password'
type SuccessState = 'magic-link' | 'verification'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isFeatureFlagEnabled(name: string): boolean {
  const value = import.meta.env[name as keyof ImportMetaEnv]
  return value === 'true' || value === '1'
}

function needsDisplayName(account: { name?: string | null; email?: string }) {
  return !account.name || account.name === account.email
}

export function AuthPanel() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  const navigate = useNavigate()
  const {
    redirect,
    mode: initialSearchMode,
    email: initialEmail,
  } = homeRouteApi.useSearch()
  const redirectTo = redirect ?? '/'
  const initialMode = initialSearchMode === 'sign-up' ? 'sign-up' : 'sign-in'

  const webOrigin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'http://localhost:3000'
  const callbackURL = `${webOrigin}${redirectTo}`
  const completeProfilePath = `/auth/complete-profile?redirect=${encodeURIComponent(redirectTo)}`
  const completeProfileCallbackURL = `${webOrigin}${completeProfilePath}`

  const [mode, setMode] = useState<Mode>(initialMode)
  const [emailVariant, setEmailVariant] = useState<EmailVariant>('magic-link')
  const [email, setEmail] = useState<string>(initialEmail ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [successState, setSuccessState] = useState<SuccessState | null>(null)

  const emailAuth = useMutation({
    retry: false,
    mutationFn: async (vars: {
      mode: Mode
      email: string
      password: string
      confirmPassword: string
    }) => {
      if (vars.mode === 'sign-in') {
        const result = await authClient.signIn.email({
          email: vars.email.trim(),
          password: vars.password,
        })
        if (result.error) {
          throw new Error(t('errors.invalidCredentials'))
        }
        return { mode: 'sign-in' as const }
      }

      if (!isStrongPassword(vars.password)) {
        throw new Error(t('errors.passwordPolicy'))
      }
      if (vars.password !== vars.confirmPassword) {
        throw new Error(t('passwordMismatch'))
      }

      const result = await authClient.signUp.email({
        email: vars.email.trim(),
        password: vars.password,
        name: '',
        callbackURL: completeProfileCallbackURL,
      })
      if (result.error) {
        throw new Error(
          result.error.message?.includes('already')
            ? t('errors.invalidCredentials')
            : t('errors.generic'),
        )
      }
      return { mode: 'sign-up' as const }
    },
    async onSuccess(data) {
      if (data.mode === 'sign-up') {
        setSuccessState('verification')
      } else {
        const session = await authClient.getSession({
          query: { disableCookieCache: true },
        })
        const account = session.data?.user
        await navigate({
          href:
            account && needsDisplayName(account)
              ? completeProfilePath
              : redirectTo,
          replace: true,
        })
      }
    },
  })

  const magicLink = useMutation({
    retry: false,
    mutationFn: async (vars: { email: string; callbackURL: string }) => {
      if (!vars.email.trim()) {
        throw new Error(t('errors.emailRequired'))
      }
      const result = await authClient.signIn.magicLink({
        email: vars.email.trim(),
        callbackURL: vars.callbackURL,
      })
      if (result.error) {
        throw new Error(t('errors.magicLinkFailed'))
      }
    },
    onSuccess() {
      setSuccessState('magic-link')
    },
  })

  const canSubmitPassword = (() => {
    if (!email.trim()) return false
    if (mode === 'sign-in') return password.length > 0
    return isStrongPassword(password) && password === confirmPassword
  })()

  function switchMode(next: Mode) {
    setMode(next)
    emailAuth.reset()
    magicLink.reset()
    setPassword('')
    setConfirmPassword('')
    setSuccessState(null)
  }

  function resetEmailFlow() {
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setSuccessState(null)
    emailAuth.reset()
    magicLink.reset()
  }

  function handleMagicLink(event: React.FormEvent) {
    event.preventDefault()
    magicLink.mutate({ email, callbackURL })
  }

  function handlePasswordSubmit(event: React.FormEvent) {
    event.preventDefault()
    emailAuth.mutate({ mode, email, password, confirmPassword })
  }

  function handleGoogle() {
    authClient.signIn.social({
      provider: 'google',
      callbackURL,
    })
  }

  function handleGithub() {
    authClient.signIn.social({
      provider: 'github',
      callbackURL,
    })
  }

  const googleEnabled = isFeatureFlagEnabled('VITE_ENABLE_GOOGLE_OAUTH')
  const githubEnabled = isFeatureFlagEnabled('VITE_ENABLE_GITHUB_OAUTH')
  const socialEnabled = googleEnabled || githubEnabled

  if (successState) {
    return (
      <AuthCard mode={mode}>
        <AuthSuccess
          email={email}
          message={
            successState === 'magic-link'
              ? t('magicLinkSent')
              : t('verificationEmailSent')
          }
          onReset={resetEmailFlow}
        />
      </AuthCard>
    )
  }

  return (
    <AuthCard mode={mode}>
      <div className="flex flex-col gap-5">
        {socialEnabled && (
          <section className="flex flex-col gap-3">
            {googleEnabled && (
              <Button
                type="button"
                variant="outline"
                className="w-full justify-center border-border/80 bg-background"
                onClick={handleGoogle}
                disabled={emailAuth.isPending || magicLink.isPending}
              >
                <GoogleIcon className="w-4 h-4 mr-2" />
                {t('signInWithGoogle')}
              </Button>
            )}
            {githubEnabled && (
              <Button
                type="button"
                variant="outline"
                className="w-full justify-center border-border/80 bg-background"
                onClick={handleGithub}
                disabled={emailAuth.isPending || magicLink.isPending}
              >
                <Github className="w-4 h-4 mr-2" />
                {t('signInWithGithub')}
              </Button>
            )}
          </section>
        )}

        {socialEnabled && (
          <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>{t('orContinueWithEmail')}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        )}

        <section className="rounded-lg bg-muted/20 p-3">
          <Tabs
            value={emailVariant}
            onValueChange={(value) => {
              setEmailVariant(value as EmailVariant)
              emailAuth.reset()
              magicLink.reset()
            }}
            className="flex flex-col gap-4"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="magic-link">{t('magicLinkTab')}</TabsTrigger>
              <TabsTrigger value="password">{t('passwordTab')}</TabsTrigger>
            </TabsList>
          </Tabs>

          {emailVariant === 'magic-link' ? (
            <MagicLinkForm
              email={email}
              error={
                magicLink.isError ? getErrorMessage(magicLink.error) : null
              }
              isPending={magicLink.isPending}
              onEmailChange={setEmail}
              onSubmit={handleMagicLink}
            />
          ) : (
            <PasswordForm
              mode={mode}
              email={email}
              password={password}
              confirmPassword={confirmPassword}
              canSubmit={canSubmitPassword}
              error={
                emailAuth.isError ? getErrorMessage(emailAuth.error) : null
              }
              isPending={emailAuth.isPending}
              onEmailChange={setEmail}
              onPasswordChange={setPassword}
              onConfirmPasswordChange={setConfirmPassword}
              onSubmit={handlePasswordSubmit}
            />
          )}
        </section>

        <div className="text-sm text-muted-foreground text-center w-full">
          {mode === 'sign-in' ? t('noAccount') : t('haveAccount')}{' '}
          <Button
            type="button"
            variant="link"
            className="h-auto px-0 py-0"
            onClick={() =>
              switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
            }
          >
            {mode === 'sign-in' ? t('createAccount') : t('signIn')}
          </Button>
        </div>
      </div>
    </AuthCard>
  )
}

function AuthCard({
  mode,
  children,
}: {
  mode: Mode
  children: React.ReactNode
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  return (
    <Card className="w-full border-border/80 shadow-sm">
      <CardHeader className="space-y-2 text-center">
        <CardTitle className="text-2xl">
          {mode === 'sign-in' ? t('title') : t('signUpTitle')}
        </CardTitle>
        <CardDescription>
          {mode === 'sign-in' ? t('subtitle') : t('signUpSubtitle')}
        </CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function MagicLinkForm(props: {
  email: string
  error: string | null
  isPending: boolean
  onEmailChange: (email: string) => void
  onSubmit: (event: React.FormEvent) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  return (
    <form className="flex flex-col gap-3 pt-4" onSubmit={props.onSubmit}>
      <EmailField value={props.email} onChange={props.onEmailChange} />
      {props.error && (
        <p className="text-sm text-destructive" role="alert">
          {props.error}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={props.isPending || !props.email.trim()}
      >
        {props.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        <Mail className="w-4 h-4 mr-2" />
        {t('sendMagicLink')}
      </Button>
    </form>
  )
}

function PasswordForm(props: {
  mode: Mode
  email: string
  password: string
  confirmPassword: string
  canSubmit: boolean
  error: string | null
  isPending: boolean
  onEmailChange: (email: string) => void
  onPasswordChange: (password: string) => void
  onConfirmPasswordChange: (password: string) => void
  onSubmit: (event: React.FormEvent) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  return (
    <form className="flex flex-col gap-3 pt-4" onSubmit={props.onSubmit}>
      <EmailField value={props.email} onChange={props.onEmailChange} />
      <div className="grid gap-1.5">
        <Label htmlFor="auth-password">{t('password')}</Label>
        <Input
          id="auth-password"
          type="password"
          autoComplete={
            props.mode === 'sign-in' ? 'current-password' : 'new-password'
          }
          value={props.password}
          onChange={(event) => props.onPasswordChange(event.target.value)}
          required
        />
      </div>
      {props.mode === 'sign-in' && (
        <Button
          asChild
          variant="link"
          size="sm"
          className="h-auto self-start px-0 py-0"
        >
          <Link
            href="/auth/forgot-password"
            search={
              props.email.trim()
                ? { email: props.email.trim() }
                : { email: undefined }
            }
          >
            {t('forgotPasswordLink')}
          </Link>
        </Button>
      )}
      {props.mode === 'sign-up' && (
        <>
          <PasswordChecklist password={props.password} />
          <div className="grid gap-1.5">
            <Label htmlFor="auth-confirm-password">
              {t('confirmPassword')}
            </Label>
            <Input
              id="auth-confirm-password"
              type="password"
              autoComplete="new-password"
              value={props.confirmPassword}
              onChange={(event) =>
                props.onConfirmPasswordChange(event.target.value)
              }
              required
            />
            {props.confirmPassword.length > 0 &&
              props.password !== props.confirmPassword && (
                <p className="text-xs text-muted-foreground">
                  {t('passwordMismatch')}
                </p>
              )}
          </div>
        </>
      )}
      {props.error && (
        <p className="text-sm text-destructive" role="alert">
          {props.error}
        </p>
      )}
      <Button
        type="submit"
        variant={props.mode === 'sign-in' ? 'default' : 'outline'}
        className="w-full"
        disabled={props.isPending || !props.canSubmit}
      >
        {props.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {props.mode === 'sign-in'
          ? t('signInWithPassword')
          : t('signUpWithPassword')}
      </Button>
    </form>
  )
}

function EmailField(props: {
  value: string
  onChange: (email: string) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="auth-email">{t('email')}</Label>
      <Input
        id="auth-email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        required
      />
    </div>
  )
}

function PasswordChecklist({ password }: { password: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  const requirements = useMemo(
    () => getPasswordRequirements(password),
    [password],
  )
  const labels: Record<PasswordRequirementId, string> = {
    minLength: t('passwordRequirements.minLength'),
    uppercase: t('passwordRequirements.uppercase'),
    lowercase: t('passwordRequirements.lowercase'),
    number: t('passwordRequirements.number'),
    symbol: t('passwordRequirements.symbol'),
  }

  return (
    <ul className="grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
      {requirements.map((requirement) => (
        <li
          key={requirement.id}
          className={cn(
            'flex items-center gap-1.5',
            requirement.isMet && 'text-foreground',
          )}
        >
          {requirement.isMet ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Circle className="h-3 w-3" />
          )}
          <span>{labels[requirement.id]}</span>
        </li>
      ))}
    </ul>
  )
}

function AuthSuccess(props: {
  email: string
  message: string
  onReset: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-6 text-center flex flex-col gap-3">
      <Mail className="w-6 h-6 mx-auto text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{props.message}</p>
      {props.email.trim() && (
        <p className="text-sm font-medium">{props.email.trim()}</p>
      )}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="mx-auto h-auto py-0"
        onClick={props.onReset}
      >
        {t('useDifferentEmail')}
      </Button>
    </div>
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
