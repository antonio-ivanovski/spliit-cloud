import { Trans, useTranslation } from 'react-i18next'

import { AuthPanel } from '@/components/auth/auth-panel'
import {
  DEFAULT_MASCOT_ID,
  getMascotDefinition,
} from '@/components/mascot/mascot-registry'
import { MascotSpeechBubble } from '@/components/mascot/mascot-speech-bubble'
import { useLandingMascot } from '@/components/mascot/use-landing-mascot'
import { useCurrentAccount } from '@/lib/use-current-account'

import { RecentGroupList } from './groups/recent-group-list'
import { SignedOutSavedGroupsEntry } from './groups/signed-out-saved-view-list'

export default function HomePage() {
  const { data: account } = useCurrentAccount()

  if (!account) {
    return (
      <main className="flex-1 px-4 py-8 sm:py-12 lg:py-16">
        <div className="container grid min-h-[calc(100vh-12rem)] max-w-(--breakpoint-lg) items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
          <LandingIntro />
          <div className="motion-enter">
            <AuthPanel />
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-(--breakpoint-md) flex-1 flex-col gap-6 px-4 py-6">
      <RecentGroupList />
    </main>
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
        <h1 className="landing-header py-2 text-3xl leading-none! font-bold sm:text-4xl lg:text-5xl">
          <Trans i18nKey="Homepage.title" components={{ strong: <strong /> }} />
        </h1>
        <p className="text-base leading-7 text-muted-foreground sm:text-lg">
          <Trans
            i18nKey="Homepage.description"
            components={{ strong: <strong /> }}
          />
        </p>
        <SignedOutSavedGroupsEntry />
      </div>
    </section>
  )
}
