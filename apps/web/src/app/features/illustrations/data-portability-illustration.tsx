// Truth: import Splitwise/CSV/bank/Cospend/Spliit; Tricount and Settle Up coming soon.
import { Clock } from 'lucide-react'

import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

import settleupLogo from './logos/settleup-logo.webp'
import splitwiseMark from './logos/splitwise-mark.webp'
import tricountLogo from './logos/tricount.webp'

export function DataPortabilityIllustration() {
  return (
    <IllustrationStage testId="data-portability-illustration">
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6">
        <div className="flex items-center gap-2">
          <div className="relative rounded-md border bg-card p-1.5">
            <img src={splitwiseMark} alt="" className="h-5 w-5 rounded-sm" />
            <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full border bg-card text-[8px] leading-none text-primary">
              ✓
            </span>
          </div>
          <div className="relative rounded-md border bg-card px-2 py-1.5">
            <img src={tricountLogo} alt="" className="h-5 w-auto" />
            <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full border bg-card">
              <Clock aria-hidden className="size-3 text-muted-foreground" />
            </span>
          </div>
          <div className="relative rounded-md border bg-card px-2 py-1.5">
            <img src={settleupLogo} alt="" className="h-5 w-auto" />
            <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full border bg-card">
              <Clock aria-hidden className="size-3 text-muted-foreground" />
            </span>
          </div>
        </div>
        <div className="flex w-44 items-center gap-1">
          <span
            aria-hidden="true"
            className="h-1 w-6 rounded-full bg-muted-foreground/30"
          />
          <span
            aria-hidden="true"
            className="h-1 w-4 rounded-full bg-muted-foreground/30"
          />
          <span
            aria-hidden="true"
            className="h-1 w-8 rounded-full bg-muted-foreground/30"
          />
        </div>
        <div className="flex w-44 items-center gap-1">
          <span
            aria-hidden="true"
            className="h-1 w-4 rounded-full bg-muted-foreground/30"
          />
          <span
            aria-hidden="true"
            className="h-1 w-8 rounded-full bg-muted-foreground/30"
          />
          <span
            aria-hidden="true"
            className="h-1 w-6 rounded-full bg-muted-foreground/30"
          />
        </div>
      </div>
    </IllustrationStage>
  )
}
