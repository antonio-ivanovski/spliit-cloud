// Truth: A paid $90 split 3 ways ($30 each), nets +$60 / −$30 / −$30 sum to zero,
// settled by two $30 payments (B→A, C→A).
import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function BalancesIllustration() {
  return (
    <IllustrationStage testId="balances-illustration">
      <div className="flex h-full items-center justify-center gap-4 px-6">
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs font-semibold text-foreground tabular-nums">
            $90
          </span>
          <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-full rounded-full bg-primary" />
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            ×3
          </span>
        </div>
        <div className="h-12 w-px bg-border" />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary tabular-nums">
              +$60
            </span>
            <span className="rounded-full border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
              −$30
            </span>
            <span className="rounded-full border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
              −$30
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-full border bg-card px-1.5 py-0.5 text-[11px] text-foreground tabular-nums">
              → $30
            </span>
            <span className="rounded-full border bg-card px-1.5 py-0.5 text-[11px] text-foreground tabular-nums">
              → $30
            </span>
          </div>
        </div>
      </div>
    </IllustrationStage>
  )
}
