import { Link } from '@tanstack/react-router'
import { Trans, useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

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
  const {
    mode,
    emailVariant,
    email,
    password,
    confirmPassword,
    successState,
    canSubmitPassword,
    canSignUp,
    hasEmailInvitation,
    googleEnabled,
    githubEnabled,
    oidcProviders,
    socialEnabled,
    setEmail,
    setPassword,
    setConfirmPassword,
    setEmailVariant,
    switchMode,
    resetEmailFlow,
    handleMagicLink,
    handlePasswordSubmit,
    handleGoogle,
    handleGithub,
    handleOidc,
    emailAuth,
    magicLink,
  } = useAuthPanel({ redirectTo })

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
      {socialEnabled && (
        <SocialButtons
          googleEnabled={googleEnabled}
          githubEnabled={githubEnabled}
          oidcProviders={oidcProviders}
          disabled={emailAuth.isPending || magicLink.isPending}
          onGoogle={handleGoogle}
          onGithub={handleGithub}
          onOidc={handleOidc}
        />
      )}

      {socialEnabled && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground uppercase">
          <div className="h-px flex-1 bg-border" />
          <span>{t('orContinueWithEmail')}</span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}

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
            <TabsTrigger value="magic-link">{t('magicLinkTab')}</TabsTrigger>
            <TabsTrigger value="password">{t('passwordTab')}</TabsTrigger>
          </TabsList>
        </Tabs>

        {emailVariant === 'magic-link' ? (
          <MagicLinkForm
            email={email}
            error={magicLink.isError ? getErrorMessage(magicLink.error) : null}
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
            error={emailAuth.isError ? getErrorMessage(emailAuth.error) : null}
            isPending={emailAuth.isPending}
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

  return embedded ? (
    <div data-auth-panel="">{content}</div>
  ) : (
    <AuthCard mode={mode}>{content}</AuthCard>
  )
}
