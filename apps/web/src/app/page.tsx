'use client'

import { AuthPanel } from '@/components/auth/auth-panel'
import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { useCurrentAccount } from '@/lib/use-current-account'
import {
  Cloud,
  Image,
  Loader2,
  Receipt,
  Scale,
  ShieldCheck,
  Split,
  Tags,
  Users,
} from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'

const signedOutFeatures = [
  { key: 'accounts', icon: ShieldCheck },
  { key: 'groupsSync', icon: Cloud },
  { key: 'expenses', icon: Receipt },
  { key: 'splitting', icon: Split },
  { key: 'settlement', icon: Scale },
  { key: 'organization', icon: Tags },
] as const satisfies ReadonlyArray<{
  key:
    | 'accounts'
    | 'groupsSync'
    | 'expenses'
    | 'splitting'
    | 'settlement'
    | 'organization'
  icon: typeof ShieldCheck
}>

const featureI18nKeys = {
  accounts: {
    title: 'Homepage.features.accounts.title',
    description: 'Homepage.features.accounts.description',
  },
  groupsSync: {
    title: 'Homepage.features.groupsSync.title',
    description: 'Homepage.features.groupsSync.description',
  },
  expenses: {
    title: 'Homepage.features.expenses.title',
    description: 'Homepage.features.expenses.description',
  },
  splitting: {
    title: 'Homepage.features.splitting.title',
    description: 'Homepage.features.splitting.description',
  },
  settlement: {
    title: 'Homepage.features.settlement.title',
    description: 'Homepage.features.settlement.description',
  },
  organization: {
    title: 'Homepage.features.organization.title',
    description: 'Homepage.features.organization.description',
  },
} as const satisfies Record<
  (typeof signedOutFeatures)[number]['key'],
  { title: string; description: string }
>

export default function HomePage() {
  const { t } = useTranslation()
  const { data: account, isPending } = useCurrentAccount()

  if (!isPending && !account) {
    return (
      <main className="flex-1 px-4 py-8 sm:py-12 lg:py-16">
        <div className="container grid min-h-[calc(100vh-12rem)] max-w-screen-lg items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
          <LandingIntro />
          <AuthPanel />
        </div>
      </main>
    )
  }

  return (
    <main>
      <section className="py-16 md:py-24 lg:py-32">
        <div className="container flex max-w-screen-md flex-col items-center gap-4 text-center">
          <h1 className="!leading-none font-bold text-2xl sm:text-3xl md:text-4xl lg:text-5xl landing-header py-2">
            <Trans
              i18nKey="Homepage.title"
              components={{ strong: <strong /> }}
            />
          </h1>
          <p className="max-w-[42rem] leading-normal text-muted-foreground sm:text-xl sm:leading-8">
            <Trans
              i18nKey="Homepage.description"
              components={{ strong: <strong /> }}
            />
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {isPending ? (
              <Button disabled size="lg">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('Auth.loading')}
              </Button>
            ) : account ? (
              <Button asChild size="lg">
                <Link href="/groups">
                  <Users className="w-4 h-4 mr-2" />
                  {t('Homepage.button.groups')}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  )
}

function LandingIntro() {
  const { t } = useTranslation()

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 text-center lg:mx-0 lg:text-left">
      <div className="flex flex-col gap-4">
        <h1 className="landing-header py-2 text-3xl font-bold !leading-none sm:text-4xl lg:text-5xl">
          <Trans i18nKey="Homepage.title" components={{ strong: <strong /> }} />
        </h1>
        <p className="text-base leading-7 text-muted-foreground sm:text-lg">
          <Trans
            i18nKey="Homepage.description"
            components={{ strong: <strong /> }}
          />
        </p>
      </div>
      <div className="grid gap-2 text-left sm:grid-cols-2">
        {signedOutFeatures.map((feature) => (
          <FeatureItem
            key={feature.key}
            icon={feature.icon}
            title={t(featureI18nKeys[feature.key].title)}
            description={t(featureI18nKeys[feature.key].description)}
          />
        ))}
      </div>
    </section>
  )
}

function FeatureItem({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Image
  title: string
  description: string
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-3 rounded-lg bg-muted/35 px-3 py-3">
      <Icon className="mt-0.5 h-4 w-4 text-primary" />
      <div className="min-w-0">
        <h2 className="text-sm font-medium leading-5">{title}</h2>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}
