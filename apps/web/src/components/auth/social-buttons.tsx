import githubSvg from '@/components/auth/github.svg'
import googleSvg from '@/components/auth/google.svg'
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
          <img src={googleSvg} alt="" className="w-4 h-4 mr-2" />
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
          <img src={githubSvg} alt="" className="w-4 h-4 mr-2" />
          {t('signInWithGithub')}
        </Button>
      )}
    </section>
  )
}
