import { useMutation } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMascotController } from '@/components/mascot/mascot-context'
import { authClient } from '@/lib/auth'
import { completeAuthSignIn } from '@/lib/auth-completion'
import { useDeploymentConfig } from '@/lib/deployment-config'
import { markInstallEligible } from '@/lib/install-eligibility'
import {
  buildCompleteProfilePath,
  hasSignupInviteProof,
  resolveAuthReturnContext,
  signupInviteFetchOptions,
} from '@/lib/signup-invite'
import { useOnlineStatus } from '@/lib/use-online-status'
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

export function useAuthPanel(options?: {
  redirectTo?: string
  /**
   * Tab shown first in the email section. Defaults to the last-used method,
   * falling back to magic link. OAuth authorization screens pass `password` so
   * reviewers with plain credentials land on the right form immediately.
   */
  initialEmailVariant?: EmailVariant
}) {
  const mascot = useMascotController()
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  const isOnline = useOnlineStatus()
  const {
    redirect,
    invite: searchInvite,
    viewKey: searchViewKey,
    mode: initialSearchMode,
    email: initialEmail,
    invitation,
    invitationAction,
  } = useSearch({ strict: false }) as HomeSearch
  // Structured return wins over the ambient search: an explicit `redirectTo`
  // prop (the OAuth review screen, the landing page) carries the destination
  // the panel must use. `redirectTo` is a full destination path — it may
  // itself embed the bearer context (e.g. `/groups/X?invite=T` resolved from
  // a bounce) — so its credentials merge with, never lose to, the ambient
  // search. Each side fills the other's gaps; structured params win ties.
  const redirectToContext = options?.redirectTo
    ? resolveAuthReturnContext({ redirect: options.redirectTo })
    : null
  // An explicit prop that resolves nowhere takes no part: the ambient search
  // keeps full authority instead of being shadowed by a bare `/`.
  const mergedRedirect =
    redirectToContext && redirectToContext.redirectTo !== '/'
      ? redirectToContext.redirectTo
      : redirect
  const returnContext = resolveAuthReturnContext({
    invitationAction: invitationAction ?? redirectToContext?.invitationAction,
    redirect: mergedRedirect,
    invite: searchInvite ?? redirectToContext?.linkInviteToken,
    viewKey: searchViewKey ?? redirectToContext?.viewKey,
    invitation: invitation ?? redirectToContext?.emailInvitationId,
  })
  const redirectTo = returnContext.redirectTo
  const deployment = useDeploymentConfig()
  const linkInviteToken = returnContext.linkInviteToken
  const hasInviteProof = hasSignupInviteProof({
    invitationAction: invitationAction ?? redirectToContext?.invitationAction,
    redirect: mergedRedirect,
    invite: searchInvite ?? redirectToContext?.linkInviteToken,
    viewKey: searchViewKey ?? redirectToContext?.viewKey,
    invitation: invitation ?? redirectToContext?.emailInvitationId,
  })
  const hasEmailInvitation = Boolean(returnContext.emailInvitationId)
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

  // Structured complete-profile hop: destination plus the bearer context
  // as first-class params — never an opaque nested `redirect=`.
  const completeProfilePath = buildCompleteProfilePath(redirectTo)
  const completeProfileCallbackURL = `${webOrigin}${completeProfilePath}`

  const callbackURL = completeProfileCallbackURL

  const [requestedMode, setRequestedMode] = useState<Mode>(initialMode)
  // Last sign-in method recorded by the better-auth `lastLoginMethod`
  // plugin (cookie, client-readable). Read once: it only changes on sign-in,
  // which navigates away from this panel.
  const [lastLoginMethod] = useState<string | null>(() =>
    authClient.getLastUsedLoginMethod(),
  )
  const [emailVariant, setEmailVariant] = useState<EmailVariant>(
    () =>
      options?.initialEmailVariant ??
      (lastLoginMethod === 'email' ? 'password' : 'magic-link'),
  )
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
      markInstallEligible()
      if (data.mode === 'sign-up') {
        mascot.react('success')
        setSuccessState('verification')
      } else {
        completeAuthSignIn({
          completeProfilePath,
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
      markInstallEligible()
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
  const emailAuthEnabled = deployment.enableEmailAuth
  const passkeyEnabled = deployment.enablePasskeyAuth ?? true
  const socialEnabled =
    googleEnabled || githubEnabled || twitterEnabled || oidcProviders.length > 0
  const mode = canSignUp ? requestedMode : 'sign-in'
  const anonymousEnabled =
    deployment.enableAnonymousAuth &&
    (deployment.signupMode === 'open' || Boolean(linkInviteToken))

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
    passkeyAuth.reset()
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
    passkeyAuth.reset()
  }

  function clearAuthErrors() {
    if (emailAuth.isError) emailAuth.reset()
    if (magicLink.isError) magicLink.reset()
    if (passkeyAuth.isError) passkeyAuth.reset()
  }

  function updateEmail(next: string) {
    setEmail(next)
    clearAuthErrors()
  }

  function updatePassword(next: string) {
    setPassword(next)
    clearAuthErrors()
  }

  function updateConfirmPassword(next: string) {
    setConfirmPassword(next)
    clearAuthErrors()
  }

  function handleMagicLink(event: React.FormEvent) {
    event.preventDefault()
    if (!isOnline) return
    magicLink.mutate({ email, callbackURL })
  }

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- better-auth session via cookies, not tRPC query cache
  const passkeyAuth = useMutation({
    retry: false,
    mutationFn: async () => {
      const result = await authClient.signIn.passkey()
      if (result.error) {
        // Closing the browser prompt surfaces as an error too; report it as
        // a cancellation so callers can stay silent instead of alarming.
        const code: unknown =
          result.error != null && typeof result.error === 'object'
            ? (result.error as { code?: unknown }).code
            : undefined
        if (typeof code === 'string' && /cancel/i.test(code)) {
          throw new Error('PASSKEY_CANCELLED')
        }
        throw new Error(t('errors.passkeyFailed'))
      }
    },
    onError(error) {
      if (error instanceof Error && error.message === 'PASSKEY_CANCELLED') {
        return
      }
      mascot.react('failure')
    },
    async onSuccess() {
      mascot.react('success')
      markInstallEligible()
      completeAuthSignIn({
        completeProfilePath,
      })
    },
  })

  function handlePasskeySignIn() {
    if (!isOnline || !passkeyEnabled) return
    passkeyAuth.mutate()
  }

  function handlePasswordSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!isOnline) return
    emailAuth.mutate({ mode, email, password, confirmPassword })
  }

  function handleGoogle() {
    if (!isOnline) return
    markInstallEligible()
    void authClient.signIn.social(
      {
        provider: 'google',
        callbackURL,
      },
      signupInviteFetchOptions(linkInviteToken),
    )
  }

  function handleGithub() {
    if (!isOnline) return
    markInstallEligible()
    void authClient.signIn.social(
      {
        provider: 'github',
        callbackURL,
      },
      signupInviteFetchOptions(linkInviteToken),
    )
  }

  function handleTwitter() {
    if (!isOnline) return
    markInstallEligible()
    void authClient.signIn.social(
      {
        provider: 'twitter',
        callbackURL,
      },
      signupInviteFetchOptions(linkInviteToken),
    )
  }

  function handleOidc(providerId: string) {
    if (!isOnline) return
    markInstallEligible()
    void authClient.signIn.social(
      {
        provider: providerId,
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
    lastLoginMethod,
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
    emailAuthEnabled,
    passkeyEnabled,
    linkInviteToken,
    callbackURL,
    setEmail: updateEmail,
    setPassword: updatePassword,
    setConfirmPassword: updateConfirmPassword,
    setEmailVariant,
    setSuccessState,
    switchMode,
    resetEmailFlow,
    handleMagicLink,
    handlePasswordSubmit,
    handlePasskeySignIn,
    handleGoogle,
    handleGithub,
    handleTwitter,
    handleOidc,
    emailAuth,
    magicLink,
    passkeyAuth,
  }
}
