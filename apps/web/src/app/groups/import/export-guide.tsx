import { CircleHelp } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog'

export type ExportGuideStep = {
  /** 1-based step number shown in the numbered badge. */
  index: number
  /** Translated step body. Keep imperative, one action per step. */
  text: string
}

type ExportGuideTriggerProps = {
  /**
   * Question-voice label on the in-card help action, written per app and import
   * mechanism (e.g. “Where do I export my Splitwise group?” for a file path vs
   * “Where do I find my Tricount share link?” for a URL path). Answers the
   * question the user has at that exact input.
   */
  trigger: string
  /** Declarative heading shown as the dialog title. */
  title: string
  steps: ExportGuideStep[]
  /** File artifact the user ends up with, e.g. “*.csv”. Shown as a badge. */
  artifact?: string
  /** Translated artifact detail, e.g. header shape or “one file per group”. */
  artifactDetail?: string
  /** Translated label preceding the artifact, e.g. “You'll get”. */
  artifactLabel?: string
  /** Translated single-line caveat (receipts, currency default, limits). */
  tip?: string
}

/**
 * Contextual “where do I find my export?” action for one import path. Lives
 * inside its input card (point of need) as a primary-colored question with a
 * help icon — a link-style action, not muted footnote text, so it reads as help
 * rather than blending into the card. The numbered steps open in a modal,
 * leaving room for visual cues later.
 */
export function ExportGuideTrigger({
  trigger,
  title,
  steps,
  artifact,
  artifactDetail,
  artifactLabel,
  tip,
}: ExportGuideTriggerProps) {
  return (
    <div data-export-guide="trigger">
      <ResponsiveDialog>
        <ResponsiveDialogTrigger
          render={
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto gap-1.5 px-0 py-1.5 text-sm font-medium"
            >
              <CircleHelp className="h-4 w-4 shrink-0" aria-hidden />
              {trigger}
            </Button>
          }
        />
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="flex flex-col gap-3">
            <ol className="flex list-none flex-col p-0">
              {steps.map((step) => (
                <li
                  key={step.index}
                  className="grid grid-cols-[22px_minmax(0,1fr)] gap-2 border-t border-border py-2 text-sm first:border-t-0 first:pt-0 last:pb-0"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground"
                  >
                    {step.index}
                  </span>
                  <span>{step.text}</span>
                </li>
              ))}
            </ol>
            {artifact ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                {artifactLabel ? <span>{artifactLabel}</span> : null}
                <code className="rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[11px]">
                  {artifact}
                </code>
                {artifactDetail ? <span>{artifactDetail}</span> : null}
              </p>
            ) : null}
            {tip ? (
              <p className="text-xs text-muted-foreground">{tip}</p>
            ) : null}
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
