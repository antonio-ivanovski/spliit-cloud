'use client'

import { AuthPanel } from '@/components/auth/auth-panel'
import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { useCurrentAccount } from '@/lib/use-current-account'
import {
  Cloud,
  Image,
  Loader2,
  Plus,
  Receipt,
  Scale,
  ShieldCheck,
  Split,
  Tags,
} from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { RecentGroupList } from './groups/recent-group-list'

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
    <main className="flex-1 max-w-screen-md w-full mx-auto px-4 py-6 flex flex-col gap-6">
      <SignedInHero />
      {isPending ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        account && <RecentGroupList />
      )}
    </main>
  )
}

function SignedInHero() {
  const { t } = useTranslation()
  const { data: account, isPending } = useCurrentAccount()

  return (
    <section className="flex flex-col gap-4 text-center sm:text-left">
      {!isPending && account?.name ? (
        <p className="text-sm text-muted-foreground">
          {t('Homepage.welcomeBack', { name: account.name })}
        </p>
      ) : null}
      <h1 className="!leading-none font-bold text-2xl sm:text-3xl md:text-4xl landing-header py-2">
        <Trans i18nKey="Homepage.title" components={{ strong: <strong /> }} />
      </h1>
      <p className="leading-normal text-muted-foreground sm:text-lg sm:leading-7">
        <Trans
          i18nKey="Homepage.description"
          components={{ strong: <strong /> }}
        />
      </p>
      <div className="flex flex-wrap gap-2 sm:justify-start justify-center">
        <Button asChild size="lg">
          <Link href="/groups/create">
            <Plus className="w-4 h-4 mr-2" />
            {t('Homepage.button.createGroup')}
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/groups/import">
            <Cloud className="w-4 h-4 mr-2" />
            {t('Homepage.button.importGroup')}
          </Link>
        </Button>
      </div>
    </section>
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
