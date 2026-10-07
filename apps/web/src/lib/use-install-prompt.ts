import { Effect } from 'effect'
import { useCallback, useEffect } from 'react'

import { hasPwaUpdateBlockers } from '@/lib/pwa-update-blockers'
import {
  selectInstallReady,
  type PwaInstallService,
  type PwaInstallSnapshot,
} from '@/lib/services/pwa-install'
import { getPwaPageServices } from '@/lib/services/pwa-wiring'
import {
  createSnapshotBridge,
  useServiceSnapshot,
} from '@/lib/services/snapshot'

/**
 * `BeforeInstallPromptEvent` is not yet in lib.dom typings — Chrome / Edge /
 * Samsung / Brave / Arc expose it on `window` and stash a deferred prompt on
 * the event so the page can decide when to surface the install UI.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type BrowserSupport =
  | 'native-install'
  | 'ios-instructions'
  | 'firefox-android-instructions'
  | 'safari-desktop-instructions'
  | 'unsupported'

export type InstallStatus =
  | 'install' // ready to be promoted
  | 'remind-later' // localStorage remind-later timer active
  | 'dismissed' // user picked "don't show again"
  | 'installed' // launched inside the installed app window
  | 'unsupported' // no install path for this browser

const REMIND_DELAY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const AUTO_OPEN_QUIET_MS = 10_000

// Manual helper requests: the app menu opens the promotion dialog on demand,
// bypassing auto-promotion cooldowns. The dialog instance subscribes. This is
// UI event plumbing (a void fan-out), not an async coordinator: state lives in
// the install service.
const manualListeners = new Set<() => void>()

export function requestManualInstallOpen(): void {
  for (const listener of Array.from(manualListeners)) {
    try {
      listener()
    } catch {
      // Listener failures must not break menu interaction.
    }
  }
}

export function subscribeManualInstallRequests(
  listener: () => void,
): () => void {
  manualListeners.add(listener)
  return () => {
    manualListeners.delete(listener)
  }
}

export function detectBrowserSupport(
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  maxTouchPoints = typeof navigator === 'undefined'
    ? 0
    : (navigator.maxTouchPoints ?? 0),
): BrowserSupport {
  const ua = userAgent

  // iPadOS 13+ sends desktop Safari UA unless the user requests mobile; the
  // touch-points heuristic picks up the iPad case.
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && maxTouchPoints > 1)
  const isAndroid = /Android/.test(ua)
  // Firefox on desktop never ships a PWA install path; only Firefox on
  // Android exposes "Install" via the browser menu.
  const isFirefox = /Firefox/.test(ua) && !/Seamonkey/.test(ua)
  const isEdge = /Edg/.test(ua)
  // Chromium-based browsers (Chrome, Brave, Arc, Vivaldi, Samsung) all
  // fire `beforeinstallprompt` once the manifest and browser installability
  // criteria are satisfied.
  const isChromium = /Chrome|Chromium|OPR/.test(ua) && !isFirefox
  const isDesktopSafari =
    /Safari/.test(ua) &&
    !/Chrome|Chromium|OPR|Edg|Firefox/.test(ua) &&
    !isIOS &&
    !isAndroid

  if (isIOS) return 'ios-instructions'
  if (isAndroid && isFirefox) return 'firefox-android-instructions'
  if (isChromium || isEdge) return 'native-install'
  if (isDesktopSafari) return 'safari-desktop-instructions'
  return 'unsupported'
}

export interface UseInstallPromptResult {
  browserSupport: BrowserSupport
  /** Whether the dialog currently has anything actionable to show. */
  readyToShow: boolean
  /** False once launched inside the installed app window. */
  installed: boolean
  /** Whether the dialog is currently open. */
  isOpen: boolean
  /** True when the open dialog was triggered by an explicit user action. */
  manualOpen: boolean
  /** Open the dialog (no-op unless auto-promotion is ready). */
  open: () => void
  /** Open the dialog on explicit user request, bypassing cooldowns. */
  openManual: () => void
  /** Close the dialog without recording any dismissal state. */
  close: () => void
  /** "Not now" — 7-day cooldown via localStorage. */
  remindLater: () => void
  /** "Don't ask again" — permanent suppression via localStorage. */
  dismiss: () => void
  /**
   * Trigger the deferred prompt (native-install only). Resolves to the user
   * choice; a native dismissal cools down like "Not now".
   */
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
}

// Closed-state bridge for renders without a page bundle (SSR, unit tests
// that render presentation without injecting a service). Never publishes;
// it only satisfies the subscription hook shape.
const CLOSED_SNAPSHOT: PwaInstallSnapshot = {
  browserSupport: 'unsupported',
  eligible: false,
  installed: false,
  promptCaptured: false,
  dismissed: false,
  remindAt: null,
  isOpen: false,
  manualOpen: false,
}
const CLOSED_BRIDGE = createSnapshotBridge(CLOSED_SNAPSHOT)

function resolveInstallService(
  injected?: PwaInstallService,
): PwaInstallService | null {
  if (injected) return injected
  try {
    return getPwaPageServices()?.install ?? null
  } catch {
    return null
  }
}

/**
 * Thin presentation binding over the page install service (Task 8).
 *
 * Native-prompt capture, eligibility, suppression, and promotion gating live
 * ONLY in PwaInstallService (page bundle, started in main.tsx before React
 * renders). This hook owns no listeners, no timers, no module capture state: it
 * subscribes to the service bridge and runs its (synchronous, infallible)
 * command Effects directly — Promise conversion at the React boundary only.
 *
 * The optional service parameter is the test seam (fresh instances per test, no
 * reset globals); production callers omit it and resolve the page bundle.
 * Without a bundle the hook renders a closed state and every command no-ops.
 *
 * The ACTIVATION BOUNDARY is preserved: install() takes the deferred prompt and
 * invokes prompt.prompt() DIRECTLY in the gesture callback, then adopts the
 * userChoice outcome into the service. No async scheduling runs before
 * invocation.
 *
 * Module note: services/pwa-install imports the pure helpers above (detection,
 * timing, blockers) while this module resolves the service through
 * services/pwa-wiring. All cross-module uses are deferred (inside factories,
 * effects, and renders), so the cycle never observes a half-initialized
 * binding.
 */
export function useInstallPrompt(
  injected?: PwaInstallService,
): UseInstallPromptResult {
  const service = resolveInstallService(injected)
  const snapshot = useServiceSnapshot(
    service?.bridge ?? CLOSED_BRIDGE,
    (current) => current,
  )

  const run = useCallback((effect: Effect.Effect<unknown>): void => {
    // Service commands are synchronous and infallible by contract; a
    // rejection here is a defect backstop, never user-visible state.
    void Effect.runPromise(effect).catch(() => undefined)
  }, [])

  // Manual helper requests bypass auto-promotion cooldowns but never an
  // installed state (the service guards both).
  useEffect(() => {
    if (!service) return
    return subscribeManualInstallRequests(() => {
      run(service.openManual)
    })
  }, [service, run])

  // oxlint-disable-next-line react/purity -- current time is intentionally sampled during render for the reminder gate.
  const readyToShow = service ? selectInstallReady(snapshot, Date.now()) : false

  // Auto-close: when conditions flip off (install completes, user dismisses,
  // remind-later kicks in, …) the open dialog must follow. Manual helper
  // opens are exempt: the user explicitly asked.
  const isOpen = snapshot.isOpen
  const manualOpen = snapshot.manualOpen
  useEffect(() => {
    if (!service) return
    if (!readyToShow && isOpen && !manualOpen) {
      run(service.close)
    }
  }, [service, readyToShow, isOpen, manualOpen, run])

  const open = useCallback(() => {
    if (service) run(service.open)
  }, [service, run])

  const openManual = useCallback(() => {
    if (service) run(service.openManual)
  }, [service, run])

  const close = useCallback(() => {
    if (service) run(service.close)
  }, [service, run])

  const install = useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'unavailable'
  > => {
    if (!service) return 'unavailable'
    const prompt = service.takePromptForGesture()
    if (!prompt) {
      await Effect.runPromise(service.reportPromptUnavailable).catch(
        () => undefined,
      )
      return 'unavailable'
    }
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice
      await Effect.runPromise(
        service.reportPromptOutcome(choice.outcome),
      ).catch(() => undefined)
      return choice.outcome
    } catch {
      // A throwing prompt (detached event, restricted storage) behaves
      // like an unavailable native path, never a crash.
      await Effect.runPromise(service.reportPromptUnavailable).catch(
        () => undefined,
      )
      return 'unavailable'
    }
  }, [service])

  const remindLater = useCallback(() => {
    if (service) run(service.remindLater)
  }, [service, run])

  const dismiss = useCallback(() => {
    if (service) run(service.dismiss)
  }, [service, run])

  return {
    browserSupport: snapshot.browserSupport,
    readyToShow,
    installed: snapshot.installed,
    isOpen,
    manualOpen,
    open,
    openManual,
    close,
    remindLater,
    dismiss,
    install,
  }
}

/**
 * Idle-gated auto-open delay and cooldown introspection for tests, without
 * importing internal module state.
 */
export const INSTALL_PROMPT_TIMING = {
  AUTO_OPEN_QUIET_MS,
  REMIND_DELAY_MS,
} as const

/**
 * Whether routine update work must wait: unfinished-work blockers OR the user
 * was recently active. Shared by the promotion auto-open path.
 */
export function shouldDeferPromotionForActivity(
  lastActivityAt: number,
  now: number = Date.now(),
): boolean {
  return now - lastActivityAt < AUTO_OPEN_QUIET_MS
}

export function isPromotionBlockedByWork(): boolean {
  try {
    return hasPwaUpdateBlockers()
  } catch {
    return false
  }
}
