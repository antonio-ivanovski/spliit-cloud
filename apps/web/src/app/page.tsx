import { Loader2 } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { AuthPanel } from '@/components/auth/auth-panel'
import { BillCharacter } from '@/components/mascot/bill-character'
import {
  useMascotController,
  useMascotState,
} from '@/components/mascot/mascot-context'
import { useCurrentAccount } from '@/lib/use-current-account'
import { cn } from '@/lib/utils'

import { RecentGroupList } from './groups/recent-group-list'

const LANDING_GREETING_MS = 3_000

export default function HomePage() {
  const { data: account, isPending } = useCurrentAccount()

  if (!isPending && !account) {
    return (
      <main className="flex-1 px-4 py-8 sm:py-12 lg:py-16">
        <div className="motion-stagger container grid min-h-[calc(100vh-12rem)] max-w-(--breakpoint-lg) items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
          <LandingIntro />
          <AuthPanel />
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-(--breakpoint-md) flex-1 flex-col gap-6 px-4 py-6">
      {isPending ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        account && (
          <>
            <RecentGroupList />
          </>
        )
      )}
    </main>
  )
}

function LandingIntro() {
  const { t } = useTranslation()
  const mascot = useMascotController()
  const mascotState = useMascotState()
  const reducedMotion = useReducedMotion()
  const [speechOpen, setSpeechOpen] = useState(false)

  useEffect(() => {
    if (!speechOpen) return
    const timer = window.setTimeout(
      () => setSpeechOpen(false),
      LANDING_GREETING_MS,
    )
    return () => window.clearTimeout(timer)
  }, [speechOpen])

  return (
    <section className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center lg:mx-0 lg:max-w-none lg:flex-row lg:items-center lg:gap-8 lg:text-start">
      <div className="flex flex-col items-center">
        <button
          type="button"
          data-testid="landing-bill"
          aria-label={t('Mascot.greetBill')}
          className="group relative shrink-0 rounded-[2rem] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          onClick={() => {
            mascot.react('success', 900)
            setSpeechOpen(true)
          }}
        >
          <BillCharacter
            className="relative h-[168px] w-[154px] drop-shadow-[0_14px_14px_hsl(var(--foreground)/0.22)] transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:scale-[1.035] group-active:translate-y-0 group-active:scale-95 sm:h-[196px] sm:w-[180px]"
            reaction={mascotState?.reaction}
            reactionKey={mascotState?.reactionKey}
          />
        </button>
        {speechOpen && (
          <div
            data-testid="landing-bill-speech"
            className={cn(
              'mt-2 max-w-[13.5rem] rounded-2xl border border-border/70 bg-background/95 px-3 py-2 text-start text-xs leading-snug text-foreground shadow-lg backdrop-blur-md',
              !reducedMotion && 'animate-in fade-in-0 zoom-in-95',
            )}
          >
            <output className="block">{t('Mascot.landingGreeting')}</output>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-4">
        <h1 className="landing-header py-2 text-3xl leading-none! font-bold sm:text-4xl lg:text-5xl">
          <Trans i18nKey="Homepage.title" components={{ strong: <strong /> }} />
        </h1>
        <p className="text-base leading-7 text-muted-foreground sm:text-lg">
          <Trans
            i18nKey="Homepage.description"
            components={{ strong: <strong /> }}
          />
        </p>
      </div>
    </section>
  )
}
