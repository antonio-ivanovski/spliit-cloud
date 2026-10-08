// Truth: the full product is available in 30 locales.
import { IllustrationStage } from '@/app/features/illustrations/illustration-shell'

export function LanguagesIllustration() {
  return (
    <IllustrationStage testId="languages-illustration">
      <div className="flex h-full items-center justify-center gap-4 px-6">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <span className="text-3xl font-bold text-primary tabular-nums">
            30
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="rounded-full border bg-card px-2.5 py-0.5 text-xs text-foreground">
            日本語
          </span>
          <span className="rounded-full border bg-card px-2.5 py-0.5 text-xs text-foreground">
            العربية
          </span>
          <span className="w-fit rounded-full border bg-card px-2.5 py-0.5 text-xs text-foreground">
            ES
          </span>
        </div>
      </div>
    </IllustrationStage>
  )
}
