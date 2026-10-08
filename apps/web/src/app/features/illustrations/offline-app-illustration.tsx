// Truth: installable PWA, groups readable offline, new expenses queue then sync.
import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

import pwaLogo from './logos/pwa.webp'

export function OfflineAppIllustration() {
  return (
    <IllustrationStage testId="offline-app-illustration">
      <div className="flex h-full items-center justify-center gap-4 px-6">
        <div className="flex size-12 items-center justify-center rounded-md border bg-card">
          <img src={pwaLogo} alt="" className="h-8 w-auto" />
        </div>
        <div className="w-24 rounded-lg border bg-card p-1.5">
          <div className="mx-auto mb-1.5 h-1 w-8 rounded-full bg-muted" />
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <div className="size-1.5 rounded-full bg-primary/60" />
              <div className="h-1.5 w-full rounded-full bg-muted" />
            </div>
            <div className="flex items-center gap-1">
              <div className="size-1.5 rounded-full bg-primary/60" />
              <div className="h-1.5 w-3/4 rounded-full bg-muted" />
            </div>
            <div className="flex items-center gap-1">
              <div className="size-1.5 rounded-full bg-primary/60" />
              <div className="h-1.5 w-5/6 rounded-full bg-muted" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="size-2.5 rounded-full bg-muted-foreground" />
          <div className="flex size-5 items-center justify-center rounded-full bg-primary/15">
            <span className="text-[10px] leading-none text-primary">✓</span>
          </div>
        </div>
      </div>
    </IllustrationStage>
  )
}
