import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Shared stage for per-card static feature illustrations.
 *
 * Contract for each `illustrations/<id>-illustration.tsx` file:
 *
 * - Export a pure component named `<PascalId>Illustration`, no props.
 * - No hooks, timers, network, animation, or `useTranslation`. Static mock data
 *   only; numbers must be arithmetically truthful (see each file's comment).
 * - No translatable text inside the stage: shapes, digits, and generic symbols
 *   (`$`, `€`, `→`) only. Meaning lives in the card title/description.
 *   Native-script locale names (`日本語`, …) are allowed as shape-like proper
 *   nouns, never sentences.
 * - Keep the DOM modest (< ~40 nodes). Dark-mode safe: semantic Tailwind tokens
 *   (`bg-primary/10`, `text-muted-foreground`, …), never hardcoded light-only
 *   colors except via `dark:` variants.
 */
export function IllustrationStage({
  testId,
  children,
  className,
}: {
  testId: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      data-testid={testId}
      aria-hidden="true"
      className={cn(
        'pointer-events-none relative h-24 overflow-hidden border-b bg-muted/40 select-none sm:h-28',
        className,
      )}
    >
      {children}
    </div>
  )
}
