import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslation } from 'react-i18next'
import { AuthCard } from './auth-card'
import { AuthSuccess } from './auth-success'
import { MagicLinkForm } from './magic-link-form'
import { PasswordForm } from './password-form'
import { SocialButtons } from './social-buttons'
import { getErrorMessage, useAuthPanel } from './use-auth-panel'

export function AuthPanel() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  const {
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
  } = useAuthPanel()

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
          <SocialButtons
            googleEnabled={googleEnabled}
            githubEnabled={githubEnabled}
            disabled={emailAuth.isPending || magicLink.isPending}
            onGoogle={handleGoogle}
            onGithub={handleGithub}
          />
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
