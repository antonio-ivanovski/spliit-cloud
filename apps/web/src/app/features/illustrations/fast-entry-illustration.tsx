// Truth: one tap applies a saved template; the amount field computes 12+8×2=28.
import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function FastEntryIllustration() {
  return (
    <IllustrationStage testId="fast-entry-illustration">
      <div className="flex h-full items-center justify-center gap-3 px-6">
        <div className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1.5 ring-1 ring-primary">
          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
        </div>
        <div className="flex items-center gap-1 rounded-full border bg-card px-2 py-1.5 opacity-60">
          <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        </div>
        <div className="rounded-md border bg-card px-2 py-1 text-[11px] tabular-nums">
          <span>12+8×2=28</span>
        </div>
        <div className="flex gap-1">
          <div className="h-2 w-10 rounded-full bg-primary/70" />
          <div className="h-2 w-10 rounded-full bg-muted" />
        </div>
      </div>
    </IllustrationStage>
  )
}
