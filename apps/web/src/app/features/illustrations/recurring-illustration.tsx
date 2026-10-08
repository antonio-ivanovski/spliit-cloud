// Truth: recurring expenses form a real series with intervals and endings, stopped explicitly.
import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function RecurringIllustration() {
  return (
    <IllustrationStage testId="recurring-illustration">
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6">
        <div className="relative flex items-center gap-2.5">
          <div
            aria-hidden="true"
            className="absolute top-1/2 right-4 left-4 h-px -translate-y-1/2 bg-border"
          />
          <div
            aria-hidden="true"
            className="relative size-2.5 rounded-full border-2 border-primary bg-card"
          />
          <div
            aria-hidden="true"
            className="relative size-2.5 rounded-full border-2 border-primary bg-card"
          />
          <div
            aria-hidden="true"
            className="relative size-2.5 rounded-full bg-primary"
          />
          <div
            aria-hidden="true"
            className="relative size-2.5 rounded-full bg-primary"
          />
          <div
            aria-hidden="true"
            className="relative size-2.5 rounded-full bg-muted-foreground/40"
          />
          <div
            aria-hidden="true"
            className="relative size-2.5 rounded-full bg-muted-foreground/40"
          />
          <div
            aria-hidden="true"
            className="relative ml-1 flex size-4 items-center justify-center rounded-[3px] bg-destructive"
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-[1px] bg-destructive-foreground"
            />
          </div>
        </div>
        <div className="flex w-24 justify-start pl-1">
          <div
            aria-hidden="true"
            className="h-2 w-11 rounded-b-md border-r-2 border-b-2 border-l-2 border-muted-foreground/40"
          />
        </div>
      </div>
    </IllustrationStage>
  )
}
