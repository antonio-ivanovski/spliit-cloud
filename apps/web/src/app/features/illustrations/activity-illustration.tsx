// Truth: For-you timeline, per-expense history/comments, filter/sort/search.
import { Search } from 'lucide-react'

import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function ActivityIllustration() {
  return (
    <IllustrationStage testId="activity-illustration">
      <div className="flex h-full items-center justify-center gap-4 px-6">
        <div aria-hidden="true" className="flex flex-col items-center">
          <span className="size-2.5 rounded-full bg-primary" />
          <span className="h-3 w-px bg-border" />
          <span className="size-2.5 rounded-full bg-muted-foreground/50" />
          <span className="h-3 w-px bg-border" />
          <span className="size-2.5 rounded-full bg-muted-foreground/50" />
        </div>
        <div className="relative rounded-md border bg-card px-2 py-1.5">
          <span
            aria-hidden="true"
            className="absolute top-1/2 -left-1 size-2 -translate-y-1/2 rotate-45 border-b border-l bg-card"
          />
          <div aria-hidden="true" className="flex flex-col gap-1">
            <span className="h-1.5 w-16 rounded-full bg-foreground/50" />
            <span className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 rounded-full border bg-card px-2 py-1">
            <Search
              aria-hidden="true"
              className="size-3 text-muted-foreground"
            />
            <span
              aria-hidden="true"
              className="h-1.5 w-10 rounded-full bg-muted-foreground/30"
            />
          </div>
          <div aria-hidden="true" className="flex items-center gap-1">
            <span className="h-1.5 w-8 rounded-full bg-primary/50" />
            <span className="h-1.5 w-8 rounded-full bg-muted-foreground/30" />
          </div>
        </div>
      </div>
    </IllustrationStage>
  )
}
