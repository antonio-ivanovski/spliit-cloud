import { getRouteApi, Link, Navigate } from '@tanstack/react-router'
import { Trans, useTranslation } from 'react-i18next'

import { AuthPanel } from '@/components/auth/auth-panel'
import { PageInset, PageShell } from '@/components/layout/page-shell'
import {
  DEFAULT_MASCOT_ID,
  getMascotDefinition,
} from '@/components/mascot/mascot-registry'
import { MascotSpeechBubble } from '@/components/mascot/mascot-speech-bubble'
import { useLandingMascot } from '@/components/mascot/use-landing-mascot'
import {
  resolveAuthReturnContext,
  splitAuthDestination,
} from '@/lib/signup-invite'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOnboardingStatus } from '@/lib/use-onboarding-status'

import { RecentGroupList } from './groups/recent-group-list'
import { SignedOutSavedGroupsEntry } from './groups/signed-out-saved-view-list'
import { LandingUpdatesTeaser } from './landing-updates'

const homeRouteApi = getRouteApi('/')

export default function HomePage() {
  const { data: account, isPending } = useCurrentAccount()
  // Settle-aware: the onboarding verdict for a fresh anonymous session lags
  // the session read. Navigating on bounce params before it lands flaps `/`
  // against `/auth/complete-profile` on every session emission (the
  // "slowing down Firefox" race) — and a completed-profile bounce through
  // here would shed the invite token mid-flap. Hold the shell instead.
  const { authReturnSettled } = useOnboardingStatus()
  const search = homeRouteApi.useSearch()
  // Structured return: credentials arrive as first-class params, so the
  // panel and the signed-in redirect resolve the same bearer context.
  const returnContext = resolveAuthReturnContext(search)
  const hasBounceSearch = Boolean(
    search.redirect || search.invite || search.viewKey || search.invitation,
  )

  if (isPending && !account) {
    return (
      <PageShell width="lg" className="flex-col gap-6 py-6" aria-busy="true" />
    )
  }

  if (!account) {
    return (
      <PageShell width="lg" className="py-8 sm:py-12 lg:py-16">
        <div className="grid min-h-[calc(100dvh-12rem)] w-full items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
          <PageInset>
            <LandingIntro />
          </PageInset>
          <div className="motion-enter">
            {/* Pass the resolved destination explicitly: the panel must not
                depend on ambient route search, or a lost hop (e.g. an
                invite-bearing return path) silently drops the invite token
                from every auth callback after sign-in. */}
            <AuthPanel redirectTo={returnContext.redirectTo} />
          </div>
        </div>
      </PageShell>
    )
  }

  // Bounce params with an unsettled verdict: hold the pending shell, exactly
  // like the cold-start branch above. The URL keeps the credentials (escrow
  // via URL), so no token sheds while the session settles.
  if (hasBounceSearch && !authReturnSettled) {
    return (
      <PageShell width="lg" className="flex-col gap-6 py-6" aria-busy="true" />
    )
  }

  if (hasBounceSearch) {
    // A bare `/` destination means "no return" — navigating to it would
    // self-loop on these same params, so render the dashboard instead.
    if (returnContext.redirectTo === '/') {
      return (
        <PageShell className="flex-col gap-6 py-6">
          <RecentGroupList />
        </PageShell>
      )
    }
    // Split the destination (see complete-profile): query-in-`to` serializes
    // verbatim and grows `?invite=T` on every lap.
    const destination = splitAuthDestination(returnContext.redirectTo)
    return (
      <Navigate
        to={destination.to}
        search={destination.search}
        hash={destination.hash}
        replace
      />
    )
  }

  return (
    <PageShell className="flex-col gap-6 py-6">
      <RecentGroupList />
    </PageShell>
  )
}

function LandingIntro() {
  const { t } = useTranslation()
  const { onTap, reaction, reactionKey, reducedMotion, speechKey } =
    useLandingMascot()
  const LandingCharacter = getMascotDefinition(DEFAULT_MASCOT_ID)?.Character

  if (!LandingCharacter) return null

  return (
    <section className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center lg:mx-0 lg:max-w-none lg:flex-row lg:items-center lg:gap-8 lg:text-start">
      <div className="relative flex flex-col items-center">
        <button
          type="button"
          data-testid="landing-bill"
          aria-label={t('Mascot.greetBill')}
          className="relative shrink-0 overflow-visible rounded-[2rem] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          onClick={onTap}
        >
          <LandingCharacter
            className="relative h-[168px] w-[154px] drop-shadow-[0_14px_14px_hsl(var(--mascot-ink)/0.22)] sm:h-[196px] sm:w-[180px] dark:drop-shadow-[0_18px_22px_hsl(0_0%_0%/0.55)]"
            reaction={reaction}
            reactionKey={reactionKey}
          />
        </button>
        {speechKey ? (
          <MascotSpeechBubble
            data-testid="landing-bill-speech"
            side="bottom"
            align="center"
            className={
              !reducedMotion
                ? 'animate-in fade-in-0 slide-in-from-top-1'
                : undefined
            }
          >
            <output className="block">{t(speechKey)}</output>
          </MascotSpeechBubble>
        ) : null}
      </div>
      <div className="motion-enter flex flex-col gap-4">
        <h1 className="landing-header py-2 font-rounded text-3xl leading-none! font-bold sm:text-4xl lg:text-5xl">
          <Trans i18nKey="Homepage.title" components={{ strong: <strong /> }} />
        </h1>
        <p className="text-base leading-7 text-muted-foreground sm:text-lg">
          <Trans
            i18nKey="Homepage.description"
            components={{ strong: <strong /> }}
          />
        </p>
        <SignedOutSavedGroupsEntry />
        <p className="mt-1">
          <Link
            to="/features"
            data-testid="landing-features-link"
            className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('Homepage.viewFeatures')}
          </Link>
        </p>
        <LandingUpdatesTeaser />
      </div>
    </section>
  )
}
