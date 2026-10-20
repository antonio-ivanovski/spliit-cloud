import { Fingerprint, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import githubSvg from '@/components/auth/github.svg'
import googleLogo from '@/components/auth/google.png'
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
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })

  const lastUsedBadge = (method: string) =>
    lastUsedMethod === method ? (
      <Badge variant="secondary" className="ms-2">
        {t('lastUsed')}
      </Badge>
    ) : null

  if (
    !passkeyEnabled &&
    !googleEnabled &&
    !githubEnabled &&
    !twitterEnabled &&
    oidcProviders.length === 0
  ) {
    return null
  }

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
          className="w-full justify-center border-[#747775] bg-white text-[#1f1f1f] hover:bg-[#f2f2f2] hover:text-[#1f1f1f] dark:border-[#8e918f] dark:bg-[#131314] dark:text-[#e3e3e3] dark:hover:bg-[#28292a] dark:hover:text-[#e3e3e3]"
          onClick={onGoogle}
          disabled={disabled}
        >
          <img
            src={googleLogo}
            alt=""
            className="me-2 h-5 w-5 shrink-0 object-contain"
          />
          {t('signInWithGoogle')}
          {lastUsedBadge('google')}
        </Button>
      )}
      {githubEnabled && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-center border-black bg-black text-white hover:bg-black/85 hover:text-white dark:border-white dark:bg-white dark:text-black dark:hover:bg-white/85 dark:hover:text-black"
          onClick={onGithub}
          disabled={disabled}
        >
          <img
            src={githubSvg}
            alt=""
            className="me-2 h-5 w-5 shrink-0 invert dark:invert-0"
          />
          {t('signInWithGithub')}
          {lastUsedBadge('github')}
        </Button>
      )}
      {twitterEnabled && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-center border-black bg-black text-white hover:bg-black/85 hover:text-white dark:border-white dark:bg-white dark:text-black dark:hover:bg-white/85 dark:hover:text-black"
          onClick={onTwitter}
          disabled={disabled}
        >
          <img
            src={xSvg}
            alt=""
            className="me-2 h-5 w-5 shrink-0 invert dark:invert-0"
          />
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
    </section>
  )
}
