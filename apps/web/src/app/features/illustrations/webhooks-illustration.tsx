// Truth: signed outbound delivery with retry.
import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function WebhooksIllustration() {
  return (
    <IllustrationStage testId="webhooks-illustration">
      <div className="flex h-full items-center justify-center gap-4 px-6">
        <div aria-hidden="true" className="flex items-center">
          <span className="size-3 rounded-full bg-primary" />
          <span className="h-px w-10 bg-border" />
          <span className="size-3 rotate-45 rounded-[2px] border border-primary bg-card" />
        </div>
        <div className="flex items-center gap-1 rounded-full border bg-card px-1.5 py-0.5">
          <span
            aria-hidden="true"
            className="text-[11px] font-semibold text-primary"
          >
            ✓
          </span>
          <span
            aria-hidden="true"
            className="h-1.5 w-8 rounded-full bg-muted-foreground/30"
          />
        </div>
        <div className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1.5">
          <span
            aria-hidden="true"
            className="text-xs font-semibold text-destructive"
          >
            ×
          </span>
          <span aria-hidden="true" className="text-xs text-muted-foreground">
            →
          </span>
          <span
            aria-hidden="true"
            className="text-xs font-semibold text-primary"
          >
            ✓
          </span>
        </div>
      </div>
    </IllustrationStage>
  )
}
