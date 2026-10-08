// Truth: managed PostgreSQL with rotating backups kept 30 days on a separate S3 bucket off the production server; recovery possible if prod fails.
import { ShieldCheck } from 'lucide-react'

import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function DataSecurityIllustration() {
  return (
    <IllustrationStage testId="data-security-illustration">
      <div className="flex h-full items-center justify-center gap-3 px-6">
        <div className="flex w-10 flex-col items-stretch">
          <div className="h-2.5 rounded-full border bg-card" />
          <div className="-mt-1.5 flex flex-col gap-1 border-x bg-card px-2 pt-2 pb-1.5">
            <div className="h-1 rounded-full bg-muted" />
            <div className="h-1 rounded-full bg-muted" />
          </div>
          <div className="-mt-1 h-2.5 rounded-t-none rounded-b-full border border-t-0 bg-card" />
        </div>
        <span aria-hidden="true" className="text-sm text-muted-foreground">
          →
        </span>
        <div className="relative flex size-12 items-center justify-center rounded-md border bg-card">
          <div className="flex h-6 w-8 flex-col overflow-hidden rounded-sm border bg-muted">
            <div className="h-1.5 border-b bg-card" />
          </div>
          <div className="absolute -right-2 -bottom-2 flex size-5 items-center justify-center rounded-full border bg-card">
            <ShieldCheck aria-hidden className="size-3 text-primary" />
          </div>
        </div>
        <div className="flex items-center rounded-full border bg-card px-2 py-0.5">
          <span className="text-xs text-muted-foreground">30</span>
        </div>
      </div>
    </IllustrationStage>
  )
}
