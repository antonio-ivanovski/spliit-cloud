import { Link } from '@tanstack/react-router'
import { FlaskConical, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  SupportOptionCard,
  SupportPageHeader,
  SupportPageShell,
} from '@/components/support'
import { buttonVariants } from '@/components/ui/button'

import { SplitSettleDemo } from './demos/split-settle-demo'
import { FEATURE_SECTIONS } from './feature-registry'

export default function FeaturesPage() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Features' })

  return (
    <SupportPageShell>
      <SupportPageHeader
        icon={Sparkles}
        title={t('hero.title')}
        description={t('hero.description')}
      />

      <section
        aria-label={t('demo.splitSettle.title')}
        className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
      >
        <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
          {t('demo.eyebrow')}
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">
          {t('demo.splitSettle.title')}
        </h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
          {t('demo.splitSettle.description')}
        </p>
        <div className="mt-5">
          <SplitSettleDemo />
        </div>
        <p className="mt-5 flex items-start gap-2 rounded-xl border bg-background px-3.5 py-3 text-sm leading-6 text-muted-foreground">
          <FlaskConical
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span>
            <strong className="font-semibold text-foreground">
              {t('demo.splitSettle.comingTitle')}
            </strong>{' '}
            — {t('demo.splitSettle.comingDescription')}
          </span>
        </p>
      </section>

      <section aria-label={t('catalogLabel')}>
        <h2 className="px-1 text-xl font-semibold tracking-tight">
          {t('catalogLabel')}
        </h2>
        <div className="mt-4 flex flex-col gap-8">
          {FEATURE_SECTIONS.map((section) => (
            <div key={section.id}>
              <h3 className="px-1 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                {t(`sections.${section.id}.title`)}
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {section.items.map((item) => (
                  <SupportOptionCard
                    key={`${section.id}-${item.id}`}
                    icon={item.icon}
                    accent="border-primary/20 bg-primary/10 text-primary"
                    title={t(`catalog.${item.id}.title`)}
                    description={t(`catalog.${item.id}.description`)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-card px-5 py-6 text-center sm:px-8">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('cta.title')}
        </h2>
        <p className="mx-auto mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
          {t('cta.description')}
        </p>
        <Link to="/" className={buttonVariants({ className: 'mt-4' })}>
          {t('cta.action')}
        </Link>
      </section>
    </SupportPageShell>
  )
}
