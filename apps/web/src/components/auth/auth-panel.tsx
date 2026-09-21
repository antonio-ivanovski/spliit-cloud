import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { authClient } from '@/lib/auth'
import { useOnlineStatus } from '@/lib/use-online-status'

import { AnonymousSignupDialog } from './anonymous-signup-dialog'
import { AuthCard } from './auth-card'
import { AuthSuccess } from './auth-success'
import { MagicLinkForm } from './magic-link-form'
import { PasswordForm } from './password-form'
import { SocialButtons } from './social-buttons'
import { getErrorMessage, useAuthPanel } from './use-auth-panel'

export function AuthPanel({
  redirectTo,
  embedded = false,
}: {
  redirectTo?: string
  embedded?: boolean
} = {}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  const isOnline = useOnlineStatus()
  const [anonymousDialogOpen, setAnonymousDialogOpen] = useState(false)
  const {
    mode,
    emailVariant,
    email,
    password,
    confirmPassword,
    successState,
    lastLoginMethod,
    canSubmitPassword,
    canSignUp,
    hasEmailInvitation,
    googleEnabled,
    githubEnabled,
    twitterEnabled,
    oidcProviders,
    anonymousEnabled,
    emailAuthEnabled,
    passkeyEnabled,
    linkInviteToken,
    redirectTo: resolvedRedirectTo,
    completeProfilePath,
    setEmail,
    setPassword,
    setConfirmPassword,
    setEmailVariant,
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
  } = useAuthPanel({ redirectTo })

  // Conditional UI: offer a registered passkey through browser autofill when
  // the platform supports it. Fire once on mount; failures (including the
  // user dismissing the prompt) are swallowed — explicit sign-in goes
  // through the passkey button below.
  useEffect(() => {
    if (!passkeyEnabled || !isOnline) return
    const mediation = window.PublicKeyCredential as unknown as
      | {
          isConditionalMediationAvailable?: () => Promise<boolean>
        }
      | undefined
    if (typeof mediation?.isConditionalMediationAvailable !== 'function') {
      return
    }
    let cancelled = false
    void mediation.isConditionalMediationAvailable().then((available) => {
      if (available && !cancelled) {
        void authClient.signIn.passkey({ autoFill: true }).catch(() => {})
      }
    })
    return () => {
      cancelled = true
    }
  }, [passkeyEnabled, isOnline])

  if (successState) {
    const success = (
      <AuthSuccess
        email={email}
        message={
          successState === 'magic-link'
            ? t('magicLinkSent')
            : t('verificationEmailSent')
        }
        onReset={resetEmailFlow}
      />
    )
    return embedded ? (
      <div data-auth-panel="">{success}</div>
    ) : (
      <AuthCard mode={mode}>{success}</AuthCard>
    )
  }

  const content = (
    <div className="flex flex-col gap-5">
      <SocialButtons
        googleEnabled={googleEnabled}
        githubEnabled={githubEnabled}
        twitterEnabled={twitterEnabled}
        oidcProviders={oidcProviders}
        passkeyEnabled={passkeyEnabled}
        passkeyPending={passkeyAuth.isPending}
        disabled={!isOnline || emailAuth.isPending || magicLink.isPending}
        lastUsedMethod={lastLoginMethod}
        onGoogle={handleGoogle}
        onGithub={handleGithub}
        onTwitter={handleTwitter}
        onOidc={handleOidc}
        onPasskey={handlePasskeySignIn}
        onAnonymous={() => setAnonymousDialogOpen(true)}
      />
      {passkeyAuth.isError ? (
        <p className="text-center text-sm text-destructive" role="alert">
          {getErrorMessage(passkeyAuth.error)}
        </p>
      ) : null}

      {!emailAuthEnabled ? (
        <>
          <p className="text-center text-sm text-muted-foreground">
            {t('emailAuthDisabled')}
          </p>
          {!canSignUp && (
            <p className="text-center text-sm text-muted-foreground">
              {t('inviteOnly.message')}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground uppercase">
            <div className="h-px flex-1 bg-border" />
            <span>{t('orContinueWithEmail')}</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <section className="rounded-lg bg-muted/20 p-3">
            <Tabs
              value={emailVariant}
              onValueChange={(value) => {
                setEmailVariant(value as 'magic-link' | 'password')
                emailAuth.reset()
                magicLink.reset()
              }}
              className="flex flex-col gap-4"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="magic-link">
                  {t('magicLinkTab')}
                  {lastLoginMethod === 'magic-link' && (
                    <Badge variant="secondary" className="ms-1.5">
                      {t('lastUsed')}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="password">
                  {t('passwordTab')}
                  {lastLoginMethod === 'email' && (
                    <Badge variant="secondary" className="ms-1.5">
                      {t('lastUsed')}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {emailVariant === 'magic-link' ? (
              <MagicLinkForm
                email={email}
                error={
                  magicLink.isError ? getErrorMessage(magicLink.error) : null
                }
                isPending={magicLink.isPending}
                disabled={!isOnline}
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
                disabled={!isOnline}
                onEmailChange={setEmail}
                onPasswordChange={setPassword}
                onConfirmPasswordChange={setConfirmPassword}
                onSubmit={handlePasswordSubmit}
              />
            )}
          </section>

          {canSignUp ? (
            <div className="w-full text-center text-sm text-muted-foreground">
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
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              {t('inviteOnly.message')}
            </p>
          )}

          {hasEmailInvitation && mode === 'sign-up' && (
            <p className="text-center text-sm text-muted-foreground">
              {t('inviteOnly.useInvitedEmail')}
            </p>
          )}
        </>
      )}

      <p className="text-center text-xs leading-5 text-muted-foreground">
        <Trans
          i18nKey="Auth.legalNotice"
          components={{
            terms: <Link to="/terms" className="underline" />,
            privacy: <Link to="/privacy" className="underline" />,
          }}
        />
      </p>
    </div>
  )

  const panel = embedded ? (
    <div data-auth-panel="">{content}</div>
  ) : (
    <AuthCard mode={mode}>{content}</AuthCard>
  )

  return (
    <>
      {panel}
      <AnonymousSignupDialog
        open={anonymousDialogOpen}
        onOpenChange={setAnonymousDialogOpen}
        creationEnabled={anonymousEnabled}
        passkeyEnabled={passkeyEnabled}
        linkInviteToken={linkInviteToken}
        redirectTo={resolvedRedirectTo}
        completeProfilePath={completeProfilePath}
      />
    </>
  )
}
