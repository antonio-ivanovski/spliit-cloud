// Truth: anonymous start, passkey, magic link, password, or Google/GitHub/X.
import { FingerprintPattern, HatGlasses } from 'lucide-react'

import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'
import githubSvg from '@/components/auth/github.svg'
import googleSvg from '@/components/auth/google.svg'
import xSvg from '@/components/auth/x.svg'

export function AccountsSigninIllustration() {
  return (
    <IllustrationStage testId="accounts-signin-illustration">
      <div className="flex h-full items-center justify-center gap-2 px-6">
        <div className="flex size-10 items-center justify-center rounded-md border bg-card">
          <HatGlasses aria-hidden className="size-5 text-muted-foreground" />
        </div>
        <div className="flex size-10 items-center justify-center rounded-md border bg-card ring-2 ring-primary">
          <FingerprintPattern aria-hidden className="size-5 text-primary" />
        </div>
        <div className="flex size-10 items-center justify-center rounded-md border bg-card">
          <img src={googleSvg} alt="" className="size-5 dark:invert" />
        </div>
        <div className="flex size-10 items-center justify-center rounded-md border bg-card">
          <img src={githubSvg} alt="" className="size-5 dark:invert" />
        </div>
        <div className="flex size-10 items-center justify-center rounded-md border bg-card">
          <img src={xSvg} alt="" className="size-5 dark:invert" />
        </div>
      </div>
    </IllustrationStage>
  )
}
