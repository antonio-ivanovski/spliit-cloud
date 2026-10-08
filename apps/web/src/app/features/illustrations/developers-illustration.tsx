// Truth: OpenAPI + Scalar docs, MCP assistant, delegated OAuth 2.1 scopes.
import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function DevelopersIllustration() {
  return (
    <IllustrationStage testId="developers-illustration">
      <div className="flex h-full items-center justify-center gap-4 px-6">
        <div className="rounded-md border bg-card px-2 py-1.5">
          <span
            aria-hidden="true"
            className="font-mono text-xs font-semibold text-primary"
          >
            {'</>'}
          </span>
        </div>
        <div
          aria-hidden="true"
          className="flex w-14 flex-col gap-1 rounded-md border bg-card p-1.5"
        >
          <span className="h-1.5 w-8 rounded-full bg-foreground/50" />
          <span className="h-1 w-full rounded-full bg-muted-foreground/30" />
          <span className="h-1 w-full rounded-full bg-muted-foreground/30" />
          <span className="h-1 w-2/3 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5">
            <span
              aria-hidden="true"
              className="text-[11px] font-semibold text-primary"
            >
              ✓
            </span>
            <span
              aria-hidden="true"
              className="h-1 w-8 rounded-full bg-primary/50"
            />
          </span>
          <span
            aria-hidden="true"
            className="rounded-full border bg-card px-1.5 py-1"
          >
            <span className="block h-1 w-10 rounded-full bg-muted-foreground/30" />
          </span>
          <span
            aria-hidden="true"
            className="rounded-full border bg-card px-1.5 py-1"
          >
            <span className="block h-1 w-10 rounded-full bg-muted-foreground/30" />
          </span>
        </div>
      </div>
    </IllustrationStage>
  )
}
