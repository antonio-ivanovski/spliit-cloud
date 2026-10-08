import type { LucideIcon } from 'lucide-react'
import { Check, Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'

import { PageInset, PageShell } from '@/components/layout/page-shell'
import { Button } from '@/components/ui/button'

/**
 * Shared scaffold, hero, cards, notices, and copy helpers for the community
 * support pages (`/feedback` and `/sponsor`) so they stay visually consistent
 * with each other.
 */

export function SupportPageShell({ children }: { children: ReactNode }) {
  return (
    <PageShell width="full" className="block py-8 sm:py-12 lg:py-16">
      <div className="motion-stagger mx-auto flex w-full max-w-5xl flex-col gap-8">
        {children}
      </div>
    </PageShell>
  )
}

export function SupportPageHeader({
  icon: Icon,
  eyebrow = 'Spliit Cloud',
  title,
  description,
  children,
}: {
  icon?: LucideIcon
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
}) {
  return (
    <PageInset>
      <header className="mx-auto max-w-3xl text-center">
        {Icon ? (
          <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary shadow-sm">
            <Icon className="size-6" aria-hidden="true" />
          </div>
        ) : null}
        {eyebrow ? (
          <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-3 font-rounded text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            {description}
          </p>
        ) : null}
        {children}
      </header>
    </PageInset>
  )
}

export function SupportOptionCard({
  icon: Icon,
  accent,
  title,
  eyebrow,
  description,
  visual,
  extra,
  footer,
}: {
  icon: LucideIcon
  accent: string
  title: ReactNode
  eyebrow?: ReactNode
  description: ReactNode
  /** Decorative visual rendered between the icon and the title. */
  visual?: ReactNode
  /** Rendered between the description and the footer (e.g. per-card notes). */
  extra?: ReactNode
  /** Bottom action; pushed to the card bottom so cards in a row align. */
  footer?: ReactNode
}) {
  if (visual) {
    return (
      <article className="flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
        {visual}
        <div
          className={`relative z-10 -mt-5 ml-4 flex size-9 items-center justify-center rounded-md border shadow-sm ${accent}`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <h2 className="px-4 pt-2.5 text-base font-semibold tracking-tight">
          {title}
        </h2>
        {eyebrow ? (
          <p className="px-4 pt-0.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {eyebrow}
          </p>
        ) : null}
        <p className="flex-1 px-4 pt-1 pb-4 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {extra}
        {footer ? <div className="px-4 pb-4">{footer}</div> : null}
      </article>
    )
  }
  return (
    <article className="group flex min-h-64 flex-col rounded-lg border bg-card p-5 shadow-sm transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg">
      <div
        className={`flex size-11 items-center justify-center rounded-md border ${accent}`}
      >
        <Icon className="size-5" aria-hidden="true" />
      </div>
      {visual ? <div className="mt-4">{visual}</div> : null}
      <h2 className="mt-5 text-lg font-semibold tracking-tight">{title}</h2>
      {eyebrow ? (
        <p className="mt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {eyebrow}
        </p>
      ) : null}
      <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {extra}
      {footer ? <div className="mt-5">{footer}</div> : null}
    </article>
  )
}

const noticeTones = {
  amber: {
    box: 'border-amber-300/60 bg-amber-50/70 dark:border-amber-900/70 dark:bg-amber-950/25',
    icon: 'text-amber-700 dark:text-amber-300',
  },
  card: {
    box: 'border bg-card shadow-sm',
    icon: 'text-primary',
  },
} as const

export function SupportNotice({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: LucideIcon
  tone: keyof typeof noticeTones
  title: ReactNode
  children: ReactNode
}) {
  const tones = noticeTones[tone]
  return (
    <div className={`rounded-lg p-5 ${tones.box}`}>
      <div className="flex gap-3">
        <Icon
          className={`mt-0.5 size-5 shrink-0 ${tones.icon}`}
          aria-hidden="true"
        />
        <div>
          <h2 className="font-semibold">{title}</h2>
          <div className="mt-1.5 text-sm leading-6 text-muted-foreground">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

export type CopyState = 'idle' | 'copied' | 'failed'

export function useCopyToClipboard() {
  const [copyState, setCopyState] = useState<CopyState>('idle')

  const copy = useCallback(async (text: string) => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }, [])

  return { copyState, copy }
}

export function CopyButton({
  copyState,
  copyLabel,
  copiedLabel,
  onCopy,
  className,
}: {
  copyState: CopyState
  copyLabel: ReactNode
  copiedLabel: ReactNode
  onCopy: () => void
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={className}
      onClick={onCopy}
    >
      {copyState === 'copied' ? (
        <Check className="me-2 size-4" aria-hidden="true" />
      ) : (
        <Copy className="me-2 size-4" aria-hidden="true" />
      )}
      {copyState === 'copied' ? copiedLabel : copyLabel}
    </Button>
  )
}
