// Truth: email + push updates with per-user category prefs.
import { Bell, Mail, Smartphone } from 'lucide-react'

import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function NotificationsIllustration() {
  return (
    <IllustrationStage testId="notifications-illustration">
      <div className="flex h-full items-center justify-center gap-4 px-6">
        <div className="flex items-center gap-1.5">
          <div className="flex size-9 items-center justify-center rounded-full bg-primary/10">
            <Bell aria-hidden="true" className="size-4 text-primary" />
          </div>
          <div className="flex size-9 items-center justify-center rounded-full border bg-card">
            <Mail aria-hidden="true" className="size-4 text-muted-foreground" />
          </div>
          <div className="flex w-7 flex-col items-center gap-1 rounded-md border bg-card py-1.5">
            <Smartphone
              aria-hidden="true"
              className="size-3 text-muted-foreground"
            />
            <span
              aria-hidden="true"
              className="size-1 rounded-full bg-muted-foreground/60"
            />
          </div>
        </div>
        <div className="h-12 w-px bg-border" />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1">
            <span
              aria-hidden="true"
              className="h-1.5 w-10 rounded-full bg-muted-foreground/30"
            />
            <span
              aria-hidden="true"
              className="flex h-3.5 w-6 items-center justify-end rounded-full bg-primary px-0.5"
            >
              <span className="size-2.5 rounded-full bg-primary-foreground" />
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1">
            <span
              aria-hidden="true"
              className="h-1.5 w-10 rounded-full bg-muted-foreground/30"
            />
            <span
              aria-hidden="true"
              className="flex h-3.5 w-6 items-center justify-start rounded-full bg-muted px-0.5"
            >
              <span className="size-2.5 rounded-full bg-muted-foreground/60" />
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1">
            <span
              aria-hidden="true"
              className="h-1.5 w-10 rounded-full bg-muted-foreground/30"
            />
            <span
              aria-hidden="true"
              className="flex h-3.5 w-6 items-center justify-start rounded-full bg-muted px-0.5"
            >
              <span className="size-2.5 rounded-full bg-muted-foreground/60" />
            </span>
          </div>
        </div>
      </div>
    </IllustrationStage>
  )
}
