import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  Bug,
  Check,
  Copy,
  ExternalLink,
  Lightbulb,
  MessageSquareText,
  ShieldCheck,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { getBrowserFeedbackDiagnostics } from '@/lib/feedback-diagnostics'

const issueForms = [
  {
    key: 'bug',
    href: 'https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml',
    icon: Bug,
    accent:
      'border-rose-200/80 bg-rose-50/60 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/25 dark:text-rose-300',
  },
  {
    key: 'idea',
    href: 'https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=idea.yml',
    icon: Lightbulb,
    accent:
      'border-amber-200/80 bg-amber-50/60 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-300',
  },
  {
    key: 'feedback',
    href: 'https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=feedback.yml',
    icon: MessageSquareText,
    accent:
      'border-emerald-200/80 bg-emerald-50/60 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/25 dark:text-emerald-300',
  },
] as const satisfies ReadonlyArray<{
  key: 'bug' | 'idea' | 'feedback'
  href: string
  icon: LucideIcon
  accent: string
}>

type CopyState = 'idle' | 'copied' | 'failed'

export default function FeedbackPage() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Feedback' })
  const diagnostics = useMemo(() => getBrowserFeedbackDiagnostics(), [])
  const [copyState, setCopyState] = useState<CopyState>('idle')

  async function copyDiagnostics() {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(diagnostics)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <main className="flex-1 px-4 py-8 sm:py-12 lg:py-16">
      <div className="motion-stagger mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
            <MessageSquareText className="size-6" aria-hidden="true" />
          </div>
          <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
            Spliit Cloud
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('title')}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            {t('description')}
          </p>
        </header>

        <section
          aria-label={t('categoriesLabel')}
          className="grid gap-4 md:grid-cols-3"
        >
          {issueForms.map(({ key, href, icon: Icon, accent }) => (
            <article
              key={key}
              className="group flex min-h-64 flex-col rounded-2xl border bg-card p-5 shadow-sm transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg"
            >
              <div
                className={`flex size-11 items-center justify-center rounded-xl border ${accent}`}
              >
                <Icon className="size-5" aria-hidden="true" />
              </div>
              <h2 className="mt-5 text-lg font-semibold tracking-tight">
                {t(`categories.${key}.title`)}
              </h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
                {t(`categories.${key}.description`)}
              </p>
              <Link
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex min-h-11 items-center justify-between gap-3 rounded-xl border bg-background px-3.5 text-sm font-medium transition-colors group-hover:border-primary/30 group-hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              >
                {t(`categories.${key}.action`)}
                <ExternalLink className="size-4" aria-hidden="true" />
              </Link>
            </article>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-amber-300/60 bg-amber-50/70 p-5 dark:border-amber-900/70 dark:bg-amber-950/25">
              <div className="flex gap-3">
                <AlertTriangle
                  className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300"
                  aria-hidden="true"
                />
                <div>
                  <h2 className="font-semibold">{t('githubNotice.title')}</h2>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    {t('githubNotice.description')}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex gap-3">
                <ShieldCheck
                  className="mt-0.5 size-5 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div>
                  <h2 className="font-semibold">{t('privacy.title')}</h2>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    {t('privacy.description')}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold">{t('diagnostics.title')}</h2>
                <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {t('diagnostics.description')}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={copyDiagnostics}
              >
                {copyState === 'copied' ? (
                  <Check className="mr-2 size-4" aria-hidden="true" />
                ) : (
                  <Copy className="mr-2 size-4" aria-hidden="true" />
                )}
                {copyState === 'copied'
                  ? t('diagnostics.copied')
                  : t('diagnostics.copy')}
              </Button>
            </div>
            <pre className="overflow-x-auto bg-slate-950 p-5 text-xs leading-6 break-words whitespace-pre-wrap text-slate-100 select-all sm:text-sm">
              {diagnostics}
            </pre>
            {copyState === 'failed' && (
              <p
                role="alert"
                className="border-t px-5 py-3 text-sm text-destructive"
              >
                {t('diagnostics.copyFailed')}
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
