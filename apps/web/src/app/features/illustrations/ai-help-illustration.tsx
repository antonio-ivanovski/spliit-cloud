// Truth: voice + receipt scan fill in expense details; bulk categorization runs after import.
import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function AiHelpIllustration() {
  return (
    <IllustrationStage testId="ai-help-illustration">
      <div className="flex h-full items-center justify-center gap-4 px-6">
        <div className="relative h-16 w-20 rounded-md border border-border bg-card p-2">
          <span
            aria-hidden="true"
            className="absolute top-1 left-1 size-2.5 rounded-tl-sm border-t-2 border-l-2 border-primary"
          />
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 size-2.5 rounded-tr-sm border-t-2 border-r-2 border-primary"
          />
          <span
            aria-hidden="true"
            className="absolute bottom-1 left-1 size-2.5 rounded-bl-sm border-b-2 border-l-2 border-primary"
          />
          <span
            aria-hidden="true"
            className="absolute right-1 bottom-1 size-2.5 rounded-br-sm border-r-2 border-b-2 border-primary"
          />
          <div className="mx-auto mt-1 h-1 w-12 rounded-full bg-muted-foreground/40" />
          <div className="mx-auto mt-1.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="mx-auto mt-1.5 h-1 w-12 rounded-full bg-muted-foreground/40" />
          <div className="mx-auto mt-1.5 h-1 w-8 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="flex flex-col items-center gap-1">
          <div
            aria-hidden="true"
            className="size-3 rotate-45 rounded-[2px] bg-primary"
          />
          <div
            aria-hidden="true"
            className="size-1 rotate-45 rounded-[1px] bg-primary/50"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pr-2.5 pl-1.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-primary"
            />
            <span className="text-xs text-primary">✓</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pr-2.5 pl-1.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-muted-foreground/50"
            />
            <span
              aria-hidden="true"
              className="h-1 w-4 rounded-full bg-muted-foreground/30"
            />
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pr-2.5 pl-1.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-muted-foreground/50"
            />
            <span
              aria-hidden="true"
              className="h-1 w-4 rounded-full bg-muted-foreground/30"
            />
          </div>
        </div>
      </div>
    </IllustrationStage>
  )
}
