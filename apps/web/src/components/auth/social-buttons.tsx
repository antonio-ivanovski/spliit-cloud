import { HatGlasses, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import githubSvg from '@/components/auth/github.svg'
import googleSvg from '@/components/auth/google.svg'
import xSvg from '@/components/auth/x.svg'
import { Button } from '@/components/ui/button'

export function SocialButtons({
  googleEnabled,
  githubEnabled,
  twitterEnabled,
  oidcProviders,
  disabled,
  onGoogle,
  onGithub,
  onTwitter,
  onOidc,
  onAnonymous,
}: {
  googleEnabled: boolean
  githubEnabled: boolean
  twitterEnabled: boolean
  oidcProviders: Array<{ id: string; name: string }>
  disabled: boolean
  onGoogle: () => void
  onGithub: () => void
  onTwitter: () => void
  onOidc: (providerId: string) => void
  onAnonymous: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })

  return (
    <section className="flex flex-col gap-3">
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
      </Button>
    </section>
  )
}
