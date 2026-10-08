// Truth: lines 10+15+5=30, tax +3 (10%), tip +6, total 39 split 3 ways = 13 each.
import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function ExpensesSplitsIllustration() {
  return (
    <IllustrationStage testId="expenses-splits-illustration">
      <div className="flex h-full items-center justify-center px-6">
        <div className="w-32 rounded-md border bg-card px-3 py-2 text-[10px] leading-tight tabular-nums">
          <div className="flex items-center justify-between text-muted-foreground">
            <div className="h-1 w-8 rounded-full bg-muted-foreground/30" />
            <span>10</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-muted-foreground">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            <span>15</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-muted-foreground">
            <div className="h-1 w-6 rounded-full bg-muted-foreground/30" />
            <span>5</span>
          </div>
          <div className="mt-1 flex items-center justify-between border-t pt-1">
            <div className="h-1 w-8 rounded-full bg-muted-foreground/40" />
            <span>30</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-muted-foreground">
            <div className="h-1 w-5 rounded-full bg-muted-foreground/30" />
            <span>+3</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-muted-foreground">
            <div className="h-1 w-5 rounded-full bg-muted-foreground/30" />
            <span>+6</span>
          </div>
          <div className="mt-1 flex items-center justify-between border-t pt-1 font-semibold">
            <div className="h-1 w-8 rounded-full bg-primary/50" />
            <span>39</span>
          </div>
          <div className="mt-1 flex items-center justify-between border-t pt-1">
            <div className="flex gap-0.5">
              <div className="h-2 w-2 rounded-full bg-primary/60" />
              <div className="h-2 w-2 rounded-full bg-primary/40" />
              <div className="h-2 w-2 rounded-full bg-primary/25" />
            </div>
            <span>13 ×3</span>
          </div>
        </div>
      </div>
    </IllustrationStage>
  )
}
