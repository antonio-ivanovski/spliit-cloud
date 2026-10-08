// Truth: open codebase, fork, self-host option.
import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function OpenSourceIllustration() {
  return (
    <IllustrationStage testId="open-source-illustration">
      <div className="flex h-full items-center justify-center gap-3 px-6">
        <div className="rounded-md border bg-card px-2 py-1.5">
          <span
            aria-hidden="true"
            className="font-mono text-xs font-semibold text-primary"
          >
            {'</>'}
          </span>
        </div>
        <span aria-hidden="true" className="h-px w-5 bg-border" />
        <div aria-hidden="true" className="flex flex-col gap-2">
          <span className="size-2.5 rounded-full bg-primary" />
          <span className="size-2.5 rounded-full bg-muted-foreground/50" />
        </div>
        <span aria-hidden="true" className="h-px w-5 bg-border" />
        <div className="flex w-10 flex-col items-center gap-1 rounded-md border bg-card p-1.5">
          <span
            aria-hidden="true"
            className="h-1 w-6 rounded-full bg-muted-foreground/30"
          />
          <span
            aria-hidden="true"
            className="h-1 w-6 rounded-full bg-muted-foreground/30"
          />
          <span
            aria-hidden="true"
            className="text-[11px] font-semibold text-primary"
          >
            ✓
          </span>
        </div>
      </div>
    </IllustrationStage>
  )
}
