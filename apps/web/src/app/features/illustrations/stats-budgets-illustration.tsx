// Truth: spending charts pair with budgets that flag over-budget categories.
import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function StatsBudgetsIllustration() {
  return (
    <IllustrationStage testId="stats-budgets-illustration">
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6">
        <span className="text-xs font-semibold text-foreground tabular-nums">
          €312
        </span>
        <div className="relative flex h-16 items-end gap-1.5">
          <div className="h-6 w-6 rounded-t bg-primary/40" />
          <div className="h-10 w-6 rounded-t bg-primary" />
          <div className="relative h-14 w-6 rounded-t bg-primary/40">
            <span className="absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-card bg-destructive" />
          </div>
          <div className="h-8 w-6 rounded-t bg-primary" />
          <div className="h-11 w-6 rounded-t bg-primary/40" />
          <div className="h-7 w-6 rounded-t bg-primary" />
          <div className="absolute right-0 bottom-10 left-0 border-t border-dashed border-destructive/70" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="size-2 rounded-full bg-primary" />
          <div className="size-2 rounded-full bg-primary/40" />
          <div className="size-2 rounded-full bg-muted-foreground/50" />
        </div>
      </div>
    </IllustrationStage>
  )
}
