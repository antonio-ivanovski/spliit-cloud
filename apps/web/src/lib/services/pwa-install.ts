import { Context, Effect, Layer } from 'effect'

import {
  isInstallEligible,
  markInstallEligible,
  subscribeInstallEligibility,
} from '@/lib/install-eligibility'
import {
  detectBrowserSupport,
  INSTALL_PROMPT_TIMING,
  isPromotionBlockedByWork,
  shouldDeferPromotionForActivity,
  type BeforeInstallPromptEvent,
  type BrowserSupport,
} from '@/lib/use-install-prompt'

import { createSnapshotBridge, type SnapshotBridge } from './snapshot'

/**
 * Install lifecycle service (Task 6).
 *
 * Eligibility, native-prompt capture, promotion gating, and suppression state
 * live here (Task 8 unified): the hook module is a thin presentation binding
 * with no listeners of its own. Test substitution runs through fresh service
 * instances (Layer/injected deps) — no reset globals.
 *
 * Guarantees preserved from the hook:
 *
 * - Eligibility ONLY from actual successful sign-in/account creation in this tab
 *   (markEligible call sites: password/OAuth/magic-link/passkey/anonymous
 *   success paths). Restored/background sessions never mark. sessionStorage
 *   backing keeps the flag tab-scoped across OAuth redirects and reloads.
 * - Native capture survives routes: the service is page-scoped, listeners attach
 *   once on start and detach on stop/scope exit.
 * - Promotion requires redirects settled + visible document + 10s idle + no
 *   unfinished-work/onboarding blocker. Installed suppresses one-way; the
 *   permanent dismissal and 7-day cooldown are honored; the manual helper
 *   bypasses cooldowns but never an installed state (and includes Safari
 *   Add-to-Dock instructions via browserSupport).
 * - ACTIVATION BOUNDARY: the service NEVER calls prompt() itself. Components call
 *   takePromptForGesture() and invoke prompt.prompt() DIRECTLY in the gesture
 *   callback, then adopt the userChoice outcome via reportPromptOutcome(). No
 *   async scheduling runs before invocation.
 */

export const INSTALL_DISMISS_KEY = 'spliit-pwa-install-dismissed'
export const INSTALL_REMIND_KEY = 'spliit-pwa-install-remind-at'

export interface PwaInstallSnapshot {
  readonly browserSupport: BrowserSupport
  readonly eligible: boolean
  readonly installed: boolean
  readonly promptCaptured: boolean
  readonly dismissed: boolean
  readonly remindAt: number | null
  readonly isOpen: boolean
  readonly manualOpen: boolean
}

export interface PwaInstallServiceDeps {
  readonly userAgent?: string
  readonly maxTouchPoints?: number
  readonly now?: () => number
  /** Tab-scoped eligibility store. Defaults to sessionStorage (guarded). */
  readonly sessionStore?: Pick<
    Storage,
    'getItem' | 'setItem' | 'removeItem'
  > | null
  /** Dismissal/cooldown store. Defaults to localStorage (guarded). */
  readonly localStore?: Pick<
    Storage,
    'getItem' | 'setItem' | 'removeItem'
  > | null
  readonly readInstalled?: () => boolean
  /** Window-like event source for capture listeners. No DOM default. */
  readonly eventSource?: {
    addEventListener: (type: string, listener: (event: Event) => void) => void
    removeEventListener: (
      type: string,
      listener: (event: Event) => void,
    ) => void
  } | null
  readonly subscribeEligibility?: (listener: () => void) => () => void
}

export interface PromotionGates {
  /** OAuth/magic-link redirects finished landing. */
  readonly redirectsSettled: boolean
  readonly visible: boolean
  readonly lastActivityAt: number
  readonly blockedByWork: boolean
  readonly onboardingActive: boolean
}

export interface PwaInstallService {
  readonly bridge: SnapshotBridge<PwaInstallSnapshot>
  readonly snapshot: Effect.Effect<PwaInstallSnapshot>
  /** Derived auto-promotion readiness at the injected clock (pure). */
  readonly readyToShow: Effect.Effect<boolean>
  /** Full promotion gate incl. visibility/idle/work/onboarding (pure). */
  readonly shouldPromote: (gates: PromotionGates) => Effect.Effect<boolean>
  readonly start: Effect.Effect<void>
  readonly stop: Effect.Effect<void>
  /** Record a genuine auth success for this tab. Never throws. */
  readonly markEligible: Effect.Effect<void>
  /**
   * Sync accessor for the gesture boundary: the component calls prompt.prompt()
   * directly in onClick, then reportPromptOutcome().
   */
  readonly takePromptForGesture: () => BeforeInstallPromptEvent | null
  readonly reportPromptOutcome: (
    outcome: 'accepted' | 'dismissed',
  ) => Effect.Effect<void>
  readonly reportPromptUnavailable: Effect.Effect<void>
  readonly open: Effect.Effect<void>
  readonly openManual: Effect.Effect<void>
  readonly close: Effect.Effect<void>
  readonly remindLater: Effect.Effect<void>
  readonly dismiss: Effect.Effect<void>
}

export const PwaInstallService =
  Context.Service<PwaInstallService>('PwaInstallService')

function guardedSessionStore(
  store: PwaInstallServiceDeps['sessionStore'],
): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  if (store !== undefined) return store ?? undefined
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

function guardedLocalStore(
  store: PwaInstallServiceDeps['localStore'],
): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  if (store !== undefined) return store ?? undefined
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function readDismissedFlag(
  store: Pick<Storage, 'getItem'> | undefined,
): boolean {
  try {
    return store?.getItem(INSTALL_DISMISS_KEY) === 'true'
  } catch {
    return false
  }
}

function readRemindAt(
  store: Pick<Storage, 'getItem'> | undefined,
): number | null {
  try {
    const raw = store?.getItem(INSTALL_REMIND_KEY)
    if (!raw) return null
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? null : parsed
  } catch {
    return null
  }
}

function defaultEventSource(): PwaInstallServiceDeps['eventSource'] {
  try {
    return typeof window === 'undefined' ? null : window
  } catch {
    return null
  }
}

/**
 * Pure auto-promotion readiness. Manual opens bypass it (openManual sets isOpen
 * directly without touching dismissed/cooldown flags).
 */
export function selectInstallReady(
  snapshot: PwaInstallSnapshot,
  nowMs: number,
): boolean {
  if (snapshot.browserSupport === 'unsupported') return false
  if (snapshot.installed) return false
  if (snapshot.dismissed) return false
  if (snapshot.remindAt !== null && nowMs < snapshot.remindAt) return false
  if (!snapshot.eligible) return false
  if (
    snapshot.browserSupport === 'native-install' &&
    !snapshot.promptCaptured
  ) {
    return false
  }
  return true
}

/**
 * Full promotion gate: readiness + settled redirects + visible + 10s idle + no
 * work/onboarding blocker.
 */
export function selectShouldPromote(
  snapshot: PwaInstallSnapshot,
  gates: PromotionGates,
  nowMs: number,
): boolean {
  if (!selectInstallReady(snapshot, nowMs)) return false
  if (!gates.redirectsSettled) return false
  if (!gates.visible) return false
  if (gates.blockedByWork || gates.onboardingActive) return false
  return !shouldDeferPromotionForActivity(gates.lastActivityAt, nowMs)
}

export function makePwaInstallService(
  deps?: PwaInstallServiceDeps,
): PwaInstallService {
  const now = deps?.now ?? (() => Date.now())
  const sessionStore = guardedSessionStore(deps?.sessionStore)
  const localStore = guardedLocalStore(deps?.localStore)
  // Display modes proving the page runs inside its installed app window.
  // Checking only `standalone` misses minimal-ui / window-controls-overlay
  // launches (unified from the legacy hook, Task 8 — single owner).
  const installedDisplayModes = [
    'fullscreen',
    'standalone',
    'minimal-ui',
    'window-controls-overlay',
    'picture-in-picture',
  ] as const
  const readInstalled =
    deps?.readInstalled ??
    (() => {
      try {
        if (typeof window === 'undefined') return false
        const launchedAsApp =
          typeof window.matchMedia === 'function' &&
          installedDisplayModes.some(
            (mode) => window.matchMedia(`(display-mode: ${mode})`).matches,
          )
        // iOS Safari exposes its own private flag for added-to-home-screen.
        const iosStandalone =
          (navigator as Navigator & { standalone?: boolean }).standalone ===
          true
        // Android TWA / Play-wrapper launches carry an android-app:// referrer.
        const twaReferrer =
          typeof document !== 'undefined' &&
          typeof document.referrer === 'string' &&
          document.referrer.startsWith('android-app://')
        return launchedAsApp || iosStandalone || twaReferrer
      } catch {
        return false
      }
    })
  const eventSource = deps?.eventSource ?? defaultEventSource()
  const subscribeEligibility =
    deps?.subscribeEligibility ?? subscribeInstallEligibility

  let prompt: BeforeInstallPromptEvent | null = null
  let stopCapture: (() => void) | null = null
  let stopEligibility: (() => void) | null = null
  let stopDisplayMode: (() => void) | null = null

  const support = detectBrowserSupport(
    deps?.userAgent ??
      (typeof navigator === 'undefined' ? '' : navigator.userAgent),
    deps?.maxTouchPoints ??
      (typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0)),
  )

  // Without a tab-scoped store (SSR) nothing can be eligible: eligibility
  // is only ever granted by an explicit auth success in this tab.
  const readEligible = (): boolean =>
    sessionStore ? isInstallEligible(sessionStore) : false

  const bridge = createSnapshotBridge<PwaInstallSnapshot>({
    browserSupport: support,
    eligible: readEligible(),
    installed: readInstalled(),
    promptCaptured: false,
    dismissed: readDismissedFlag(localStore),
    remindAt: readRemindAt(localStore),
    isOpen: false,
    manualOpen: false,
  })

  const refresh = (): void => {
    const current = bridge.getSnapshot()
    bridge.publish({
      ...current,
      eligible: readEligible(),
      installed: current.installed || readInstalled(),
      promptCaptured: prompt !== null,
      dismissed: readDismissedFlag(localStore),
      remindAt: readRemindAt(localStore),
    })
  }

  const handleBeforeInstallPrompt = (event: Event): void => {
    try {
      event.preventDefault()
    } catch {
      // Best-effort on synthetic test events.
    }
    prompt = event as BeforeInstallPromptEvent
    refresh()
  }

  const handleAppInstalled = (): void => {
    prompt = null
    try {
      localStore?.removeItem(INSTALL_DISMISS_KEY)
      localStore?.removeItem(INSTALL_REMIND_KEY)
    } catch {
      // Restricted storage must not break the installed transition.
    }
    const current = bridge.getSnapshot()
    bridge.publish({
      ...current,
      installed: true,
      promptCaptured: false,
      dismissed: false,
      remindAt: null,
      isOpen: false,
      manualOpen: false,
    })
  }

  const start: PwaInstallService['start'] = Effect.sync(() => {
    if (stopCapture) return
    // One-way installed suppression: a page moving into an installed display
    // mode while open (install completed in another tab, browser UI install)
    // suppresses from now on. Leaving the app window mid-session never re-arms.
    try {
      if (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function'
      ) {
        const queries = installedDisplayModes.map((mode) =>
          window.matchMedia(`(display-mode: ${mode})`),
        )
        const onChange = () => {
          try {
            if (readInstalled()) refresh()
          } catch {
            // Detection failures never break capture.
          }
        }
        for (const query of queries) {
          if (typeof query.addEventListener === 'function') {
            query.addEventListener('change', onChange)
          }
        }
        stopDisplayMode = () => {
          for (const query of queries) {
            if (typeof query.removeEventListener === 'function') {
              query.removeEventListener('change', onChange)
            }
          }
        }
      }
    } catch {
      stopDisplayMode = null
    }
    if (eventSource) {
      eventSource.addEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      )
      eventSource.addEventListener('appinstalled', handleAppInstalled)
      stopCapture = () => {
        eventSource.removeEventListener(
          'beforeinstallprompt',
          handleBeforeInstallPrompt,
        )
        eventSource.removeEventListener('appinstalled', handleAppInstalled)
      }
    }
    stopEligibility = subscribeEligibility(refresh)
    refresh()
  })

  const stop: PwaInstallService['stop'] = Effect.sync(() => {
    stopCapture?.()
    stopCapture = null
    stopEligibility?.()
    stopEligibility = null
    stopDisplayMode?.()
    stopDisplayMode = null
  })

  return {
    bridge,
    snapshot: bridge.readEffect,
    readyToShow: Effect.sync(() =>
      selectInstallReady(bridge.getSnapshot(), now()),
    ),
    shouldPromote: (gates) =>
      Effect.sync(() =>
        selectShouldPromote(bridge.getSnapshot(), gates, now()),
      ),
    start,
    stop,
    markEligible: Effect.sync(() => {
      markInstallEligible(sessionStore)
      refresh()
    }),
    takePromptForGesture: () => prompt,
    reportPromptOutcome: (outcome) =>
      Effect.sync(() => {
        prompt = null
        if (outcome === 'accepted') {
          const current = bridge.getSnapshot()
          bridge.publish({ ...current, installed: true, promptCaptured: false })
          return
        }
        // A native dismissal cools down like "Not now" (7-day timer).
        try {
          localStore?.setItem(
            INSTALL_REMIND_KEY,
            new Date(
              now() + INSTALL_PROMPT_TIMING.REMIND_DELAY_MS,
            ).toISOString(),
          )
        } catch {
          // Restricted storage: the in-memory state still applies below.
        }
        refresh()
      }),
    reportPromptUnavailable: Effect.sync(() => {
      prompt = null
      refresh()
    }),
    open: Effect.sync(() => {
      const current = bridge.getSnapshot()
      if (!selectInstallReady(current, now())) return
      bridge.publish({ ...current, isOpen: true })
    }),
    openManual: Effect.sync(() => {
      const current = bridge.getSnapshot()
      if (current.browserSupport === 'unsupported' || current.installed) return
      bridge.publish({ ...current, manualOpen: true, isOpen: true })
    }),
    close: Effect.sync(() => {
      const current = bridge.getSnapshot()
      bridge.publish({ ...current, manualOpen: false, isOpen: false })
    }),
    remindLater: Effect.sync(() => {
      const next = now() + INSTALL_PROMPT_TIMING.REMIND_DELAY_MS
      try {
        localStore?.setItem(INSTALL_REMIND_KEY, new Date(next).toISOString())
      } catch {
        // In-memory state still applies.
      }
      const current = bridge.getSnapshot()
      bridge.publish({
        ...current,
        remindAt: next,
        manualOpen: false,
        isOpen: false,
      })
    }),
    dismiss: Effect.sync(() => {
      try {
        localStore?.setItem(INSTALL_DISMISS_KEY, 'true')
      } catch {
        // In-memory state still applies.
      }
      const current = bridge.getSnapshot()
      bridge.publish({
        ...current,
        dismissed: true,
        manualOpen: false,
        isOpen: false,
      })
    }),
  }
}

/** Page-scoped install layer: capture listeners detach when the scope exits. */
export function makePwaInstallServiceLive(
  deps?: PwaInstallServiceDeps,
): Layer.Layer<PwaInstallService> {
  return Layer.effect(
    PwaInstallService,
    Effect.acquireRelease(
      Effect.sync(() => makePwaInstallService(deps)),
      (service) => service.stop,
    ),
  )
}

export { isPromotionBlockedByWork }
