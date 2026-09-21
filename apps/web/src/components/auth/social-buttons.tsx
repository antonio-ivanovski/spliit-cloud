import { Fingerprint, HatGlasses, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import githubSvg from '@/components/auth/github.svg'
import googleSvg from '@/components/auth/google.svg'
import xSvg from '@/components/auth/x.svg'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function SocialButtons({
  googleEnabled,
  githubEnabled,
  twitterEnabled,
  oidcProviders,
  passkeyEnabled,
  passkeyPending,
  disabled,
  lastUsedMethod,
  onGoogle,
  onGithub,
  onTwitter,
  onOidc,
  onPasskey,
  onAnonymous,
}: {
  googleEnabled: boolean
  githubEnabled: boolean
  twitterEnabled: boolean
  oidcProviders: Array<{ id: string; name: string }>
  passkeyEnabled: boolean
  passkeyPending: boolean
  disabled: boolean
  lastUsedMethod: string | null
  onGoogle: () => void
  onGithub: () => void
  onTwitter: () => void
  onOidc: (providerId: string) => void
  onPasskey: () => void
  onAnonymous: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })

  const lastUsedBadge = (method: string) =>
    lastUsedMethod === method ? (
      <Badge variant="secondary" className="ms-2">
        {t('lastUsed')}
      </Badge>
    ) : null

  return (
    <section className="flex flex-col gap-3">
      {passkeyEnabled && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-center border-border/80 bg-background"
          onClick={onPasskey}
          disabled={disabled || passkeyPending}
        >
          <Fingerprint className="me-2 h-4 w-4" />
          {t('signInWithPasskey')}
          {lastUsedBadge('passkey')}
        </Button>
      )}
      {googleEnabled && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-center border-border/80 bg-background"
          onClick={onGoogle}
          disabled={disabled}
        >
          <img src={googleSvg} alt="" className="me-2 h-4 w-4 dark:invert" />
          {t('signInWithGoogle')}
          {lastUsedBadge('google')}
        </Button>
      )}
      {githubEnabled && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-center border-border/80 bg-background"
          onClick={onGithub}
          disabled={disabled}
        >
          <img src={githubSvg} alt="" className="me-2 h-4 w-4 dark:invert" />
          {t('signInWithGithub')}
          {lastUsedBadge('github')}
        </Button>
      )}
      {twitterEnabled && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-center border-border/80 bg-background"
          onClick={onTwitter}
          disabled={disabled}
        >
          <img src={xSvg} alt="" className="me-2 h-4 w-4 dark:invert" />
          {t('signInWithX')}
          {lastUsedBadge('twitter')}
        </Button>
      )}
      {oidcProviders.map((provider) => (
        <Button
          key={provider.id}
          type="button"
          variant="outline"
          className="w-full justify-center border-border/80 bg-background"
          onClick={() => onOidc(provider.id)}
          disabled={disabled}
        >
          <KeyRound className="me-2 h-4 w-4" />
          {t('signInWithOidc', { name: provider.name })}
          {lastUsedBadge(provider.id)}
        </Button>
      ))}
      <Button
        type="button"
        variant="outline"
        className="w-full justify-center border-border/80 bg-background"
        onClick={onAnonymous}
        disabled={disabled}
      >
        <HatGlasses className="me-2 h-4 w-4" />
        {t('signInAnonymously')}
        {lastUsedBadge('anonymous')}
      </Button>
    </section>
  )
}
