import { useMutation } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMascotController } from '@/components/mascot/mascot-context'
import { needsDisplayName } from '@/lib/account'
import { authClient } from '@/lib/auth'
import { useDeploymentConfig } from '@/lib/deployment-config'
import {
  extractLinkInviteTokenFromRedirect,
  hasSignupInviteProof,
  signupInviteFetchOptions,
} from '@/lib/signup-invite'
import type { HomeSearch } from '@/router/schemas'
import { isStrongPassword } from '@spliit/domain/password'

export type Mode = 'sign-in' | 'sign-up'
export type EmailVariant = 'magic-link' | 'password'
export type SuccessState = 'magic-link' | 'verification'

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isSignupInviteRequired(
  error: { code?: string; message?: string } | null,
) {
  return (
    error?.code === 'SIGNUP_INVITE_REQUIRED' ||
    error?.message?.includes('invite-only') === true
  )
}

export function useAuthPanel(options?: { redirectTo?: string }) {
  const mascot = useMascotController()
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  const navigate = useNavigate()
  const {
    redirect,
    mode: initialSearchMode,
    email: initialEmail,
    invitation,
  } = useSearch({ strict: false }) as HomeSearch
  const redirectTo = options?.redirectTo ?? redirect ?? '/'
  const deployment = useDeploymentConfig()
  const linkInviteToken =
    invitation?.trim() || extractLinkInviteTokenFromRedirect(redirect)
  const hasInviteProof = hasSignupInviteProof({ redirect, invitation })
  const hasEmailInvitation = Boolean(invitation?.trim())
  const canSignUp =
    deployment.signupMode === 'open' ||
    deployment.allowUninvitedSignup ||
    hasInviteProof
  const initialMode =
    canSignUp && (hasInviteProof || initialSearchMode === 'sign-up')
      ? 'sign-up'
      : 'sign-in'

  const webOrigin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'http://localhost:3000'
  const callbackURL = `${webOrigin}${redirectTo}`
  const completeProfilePath = `/auth/complete-profile?redirect=${encodeURIComponent(redirectTo)}`
  const completeProfileCallbackURL = `${webOrigin}${completeProfilePath}`

  const [requestedMode, setRequestedMode] = useState<Mode>(initialMode)
  const [emailVariant, setEmailVariant] = useState<EmailVariant>('magic-link')
  const [email, setEmail] = useState<string>(initialEmail ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [successState, setSuccessState] = useState<SuccessState | null>(null)

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- better-auth session via cookies, not tRPC query cache
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

      const inviteHeaders = signupInviteFetchOptions(linkInviteToken)
      const result = await authClient.signUp.email(
        {
          email: vars.email.trim(),
          password: vars.password,
          name: '',
          callbackURL: completeProfileCallbackURL,
        },
        inviteHeaders,
      )
      if (result.error) {
        throw new Error(
          isSignupInviteRequired(result.error)
            ? t('errors.signupInviteRequired')
            : result.error.message?.includes('already')
              ? t('errors.invalidCredentials')
              : t('errors.generic'),
        )
      }
      return { mode: 'sign-up' as const }
    },
    onError() {
      mascot.react('failure')
    },
    async onSuccess(data) {
      if (data.mode === 'sign-up') {
        mascot.react('success')
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

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- better-auth session via cookies, not tRPC query cache
  const magicLink = useMutation({
    retry: false,
    mutationFn: async (vars: { email: string; callbackURL: string }) => {
      if (!vars.email.trim()) {
        throw new Error(t('errors.emailRequired'))
      }
      const result = await authClient.signIn.magicLink(
        {
          email: vars.email.trim(),
          callbackURL: vars.callbackURL,
          newUserCallbackURL: completeProfileCallbackURL,
        },
        signupInviteFetchOptions(linkInviteToken),
      )
      if (result.error) {
        throw new Error(
          isSignupInviteRequired(result.error)
            ? t('errors.signupInviteRequired')
            : t('errors.magicLinkFailed'),
        )
      }
    },
    onSuccess() {
      mascot.react('success')
      setSuccessState('magic-link')
    },
    onError() {
      mascot.react('failure')
    },
  })

  const googleEnabled = deployment.enableGoogleOAuth
  const githubEnabled = deployment.enableGitHubOAuth
  const twitterEnabled = deployment.enableTwitterOAuth
  const oidcProviders = deployment.oidcProviders
  const socialEnabled =
    googleEnabled || githubEnabled || twitterEnabled || oidcProviders.length > 0
  const mode = canSignUp ? requestedMode : 'sign-in'
  const anonymousEnabled = deployment.enableAnonymousAuth

  const canSubmitPassword = (() => {
    if (!email.trim()) return false
    if (mode === 'sign-in') return password.length > 0
    return isStrongPassword(password) && password === confirmPassword
  })()

  function switchMode(next: Mode) {
    if (next === 'sign-up' && !canSignUp) return
    setRequestedMode(next)
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
    void authClient.signIn.social(
      {
        provider: 'google',
        callbackURL,
      },
      signupInviteFetchOptions(linkInviteToken),
    )
  }

  function handleGithub() {
    void authClient.signIn.social(
      {
        provider: 'github',
        callbackURL,
      },
      signupInviteFetchOptions(linkInviteToken),
    )
  }

  function handleTwitter() {
    void authClient.signIn.social(
      {
        provider: 'twitter',
        callbackURL,
      },
      signupInviteFetchOptions(linkInviteToken),
    )
  }

  function handleOidc(providerId: string) {
    void authClient.signIn.oauth2(
      {
        providerId,
        callbackURL,
      },
      signupInviteFetchOptions(linkInviteToken),
    )
  }

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
    canSignUp,
    hasEmailInvitation,
    googleEnabled,
    githubEnabled,
    twitterEnabled,
    oidcProviders,
    socialEnabled,
    anonymousEnabled,
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
    handleTwitter,
    handleOidc,
    emailAuth,
    magicLink,
  }
}
