// Truth: imported expenses categorized in bulk by a System One decision model with per-expense confidence.
import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function BulkCategorizeIllustration() {
  return (
    <IllustrationStage testId="bulk-categorize-illustration">
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6">
        <div className="flex w-52 items-center gap-2 rounded-md border bg-card px-2 py-1">
          <div className="flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5">
            <div className="size-1.5 rounded-full bg-primary" />
            <div className="h-1 w-6 rounded-full bg-primary/60" />
          </div>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-[87%] rounded-full bg-primary" />
          </div>
          <span className="text-[10px] font-semibold text-foreground tabular-nums">
            87%
          </span>
          <span className="text-[10px] leading-none text-primary">✓</span>
        </div>
        <div className="flex w-52 items-center gap-2 rounded-md border bg-card px-2 py-1">
          <div className="flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5">
            <div className="size-1.5 rounded-full bg-muted-foreground/60" />
            <div className="h-1 w-6 rounded-full bg-muted-foreground/40" />
          </div>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-3/4 rounded-full bg-primary/60" />
          </div>
          <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">
            74%
          </span>
        </div>
        <div className="flex w-52 items-center gap-2 rounded-md border bg-card px-2 py-1">
          <div className="flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5">
            <div className="size-1.5 rounded-full bg-muted-foreground/60" />
            <div className="h-1 w-6 rounded-full bg-muted-foreground/40" />
          </div>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-2/3 rounded-full bg-primary/60" />
          </div>
          <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">
            68%
          </span>
        </div>
      </div>
    </IllustrationStage>
  )
}
