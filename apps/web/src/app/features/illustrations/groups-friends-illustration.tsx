// Truth: groups gather friends, 1-on-1 balances form a ledger, archiving makes it view-only.
import { UserRound } from 'lucide-react'

import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function GroupsFriendsIllustration() {
  return (
    <IllustrationStage testId="groups-friends-illustration">
      <div className="flex h-full items-center justify-center gap-4 px-6">
        <div className="flex items-center rounded-full border bg-card px-2.5 py-2">
          <div className="flex size-5 items-center justify-center rounded-full border bg-card">
            <UserRound aria-hidden className="size-3 text-primary" />
          </div>
          <div className="-ml-1.5 flex size-5 items-center justify-center rounded-full border bg-card ring-2 ring-card">
            <UserRound aria-hidden className="size-3 text-primary" />
          </div>
          <div className="-ml-1.5 flex size-5 items-center justify-center rounded-full border bg-card ring-2 ring-card">
            <UserRound aria-hidden className="size-3 text-primary" />
          </div>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-1.5">
            <div className="flex size-5 items-center justify-center rounded-full border bg-card">
              <UserRound aria-hidden className="size-3 text-primary" />
            </div>
            <div className="flex size-5 items-center justify-center rounded-full border bg-card">
              <UserRound aria-hidden className="size-3 text-muted-foreground" />
            </div>
          </div>
          <div className="flex h-1.5 w-16 overflow-hidden rounded-full">
            <div className="w-2/3 bg-primary/60" />
            <div className="w-1/3 bg-muted" />
          </div>
        </div>
        <div className="flex w-10 flex-col overflow-hidden rounded-md border bg-card">
          <div className="h-1.5 bg-muted" />
          <div className="flex items-center justify-center py-1.5">
            <span className="text-xs text-primary">✓</span>
          </div>
        </div>
      </div>
    </IllustrationStage>
  )
}
