import { Link } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  SupportOptionCard,
  SupportPageHeader,
  SupportPageShell,
} from '@/components/support'
import { buttonVariants } from '@/components/ui/button'
import { getApiBaseUrl } from '@/lib/api-url'

import { FEATURE_SECTIONS } from './feature-registry'
import { FEATURE_ILLUSTRATIONS } from './illustrations/illustration-registry'

const GITHUB_URL = 'https://github.com/antonio-ivanovski/spliit-cloud'

const footerLinkClassName =
  'inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border bg-background px-3.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'

export default function FeaturesPage() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Features' })

  return (
    <SupportPageShell>
      <SupportPageHeader
        eyebrow={null}
        title={t('hero.title')}
        description={t('hero.description')}
      />

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
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                {section.items.map((item) => {
                  const Showcase = FEATURE_ILLUSTRATIONS[item.id]
                  const footer =
                    item.id === 'open-source' ? (
                      <a
                        href={GITHUB_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={footerLinkClassName}
                      >
                        {t('catalog.open-source.action')}
                        <ExternalLink className="size-4" aria-hidden="true" />
                      </a>
                    ) : item.id === 'webhooks' ||
                      item.id === 'notifications' ? (
                      <Link
                        to="/account/settings"
                        hash={item.id}
                        className={footerLinkClassName}
                      >
                        {t(`catalog.${item.id}.action`)}
                        <ExternalLink className="size-4" aria-hidden="true" />
                      </Link>
                    ) : item.id === 'developers' ? (
                      <a
                        href={`${getApiBaseUrl()}/docs`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={footerLinkClassName}
                      >
                        {t('catalog.developers.action')}
                        <ExternalLink className="size-4" aria-hidden="true" />
                      </a>
                    ) : undefined
                  return (
                    <SupportOptionCard
                      key={`${section.id}-${item.id}`}
                      icon={item.icon}
                      accent="border-primary/20 bg-card text-primary"
                      title={t(`catalog.${item.id}.title`)}
                      description={t(`catalog.${item.id}.description`)}
                      visual={<Showcase />}
                      footer={footer}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg bg-card px-5 py-6 text-center sm:px-8">
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
