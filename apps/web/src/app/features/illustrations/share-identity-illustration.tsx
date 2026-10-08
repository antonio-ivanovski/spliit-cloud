// Truth: invite via link, email, or QR — equal choices.
import { Link2, Mail, QrCode } from 'lucide-react'

import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function ShareIdentityIllustration() {
  return (
    <IllustrationStage testId="share-identity-illustration">
      <div className="flex h-full items-center justify-center gap-2 px-6">
        <div className="flex size-12 items-center justify-center rounded-md border bg-card">
          <Link2 aria-hidden className="size-5 text-primary" />
        </div>
        <div className="flex size-12 items-center justify-center rounded-md border bg-card">
          <Mail aria-hidden className="size-5 text-primary" />
        </div>
        <div className="flex size-12 items-center justify-center rounded-md border bg-card">
          <QrCode aria-hidden className="size-5 text-primary" />
        </div>
      </div>
    </IllustrationStage>
  )
}
