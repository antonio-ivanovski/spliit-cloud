// Truth: live rates — fiat via Frankfurter, crypto via Coinbase; $42 at 0.92 = €38.64.
import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function CurrencyIllustration() {
  return (
    <IllustrationStage testId="currency-illustration">
      <div className="flex h-full items-center justify-center gap-3 px-6">
        <div className="flex items-center">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            $
          </div>
          <div className="-ms-2 flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
            €
          </div>
          <div className="-ms-2 flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
            £
          </div>
          <div className="-ms-2 flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
            ¥
          </div>
          <div
            aria-hidden="true"
            className="-ms-1 size-4 rotate-45 rounded-[3px] bg-primary/40"
          />
        </div>
        <span className="text-sm font-semibold text-foreground tabular-nums">
          42
        </span>
        <span className="text-sm text-muted-foreground">→</span>
        <div className="flex items-center gap-1.5">
          <div className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
            €
          </div>
          <span className="text-sm font-semibold text-foreground tabular-nums">
            38.64
          </span>
        </div>
      </div>
    </IllustrationStage>
  )
}
