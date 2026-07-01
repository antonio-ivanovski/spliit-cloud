import GithubIcon from '@/components/auth/github.svg?react'
import GoogleIcon from '@/components/auth/google.svg?react'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

export function SocialButtons({
  googleEnabled,
  githubEnabled,
  disabled,
  onGoogle,
  onGithub,
}: {
  googleEnabled: boolean
  githubEnabled: boolean
  disabled: boolean
  onGoogle: () => void
  onGithub: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })

  if (!googleEnabled && !githubEnabled) return null

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
          <GoogleIcon className="w-4 h-4 mr-2" aria-hidden="true" />
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
          <GithubIcon className="w-4 h-4 mr-2" aria-hidden="true" />
          {t('signInWithGithub')}
        </Button>
      )}
    </section>
  )
}
