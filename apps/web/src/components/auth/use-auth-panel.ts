import { authClient } from '@/lib/auth'
import { isStrongPassword } from '@spliit/domain/password'
import { useMutation } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const homeRouteApi = getRouteApi('/')

export type Mode = 'sign-in' | 'sign-up'
export type EmailVariant = 'magic-link' | 'password'
export type SuccessState = 'magic-link' | 'verification'

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function isFeatureFlagEnabled(name: string): boolean {
  const value = import.meta.env[name as keyof ImportMetaEnv]
  return value === 'true' || value === '1'
}

function needsDisplayName(account: { name?: string | null; email?: string }) {
  return !account.name || account.name === account.email
}

export function useAuthPanel() {
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

  return {
    mode,
    emailVariant,
    email,
    password,
    confirmPassword,
    successState,
    redirectTo,
    completeProfilePath,
    canSubmitPassword,
    googleEnabled,
    githubEnabled,
    socialEnabled,
    callbackURL,
    setEmail,
    setPassword,
    setConfirmPassword,
    setEmailVariant,
    setSuccessState,
    switchMode,
    resetEmailFlow,
    handleMagicLink,
    handlePasswordSubmit,
    handleGoogle,
    handleGithub,
    emailAuth,
    magicLink,
  }
}
