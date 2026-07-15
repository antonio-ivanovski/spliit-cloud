import { useCallback, useEffect, useState } from 'react'

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
  | 'unsupported'

export type InstallStatus =
  | 'install' // ready to be promoted
  | 'remind-later' // localStorage remind-later timer active
  | 'dismissed' // user picked "don't show again"
  | 'installed' // display-mode is standalone (already installed)
  | 'unsupported' // no install path for this browser

const DISMISS_KEY = 'spliit-pwa-install-dismissed'
const REMIND_KEY = 'spliit-pwa-install-remind-at'
const REMIND_DELAY_MS = 24 * 60 * 60 * 1000 // 24h
const AUTO_OPEN_DELAY_MS = 2000

function detectBrowserSupport(): BrowserSupport {
  if (typeof navigator === 'undefined') return 'unsupported'
  const ua = navigator.userAgent

  // iPadOS 13+ sends desktop Safari UA unless the user requests mobile; the
  // touch-points heuristic picks up the iPad case.
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Mac') && navigator.maxTouchPoints > 1)
  const isAndroid = /Android/.test(ua)
  // Firefox on desktop never ships a PWA install path; only Firefox on
  // Android exposes "Install" via the browser menu.
  const isFirefox = /Firefox/.test(ua) && !/Seamonkey/.test(ua)
  const isEdge = /Edg/.test(ua)
  // Chromium-based browsers (Chrome, Brave, Arc, Vivaldi, Samsung) all
  // fire `beforeinstallprompt` once the manifest and browser installability
  // criteria are satisfied.
  const isChromium = /Chrome|Chromium|OPR/.test(ua) && !isFirefox

  if (isIOS) return 'ios-instructions'
  if (isAndroid && isFirefox) return 'firefox-android-instructions'
  if (isChromium || isEdge) return 'native-install'
  return 'unsupported'
}

function readDismissed(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(DISMISS_KEY) === 'true'
}

function readRemindAt(): number | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(REMIND_KEY)
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : parsed
}

function readInstalled(): boolean {
  if (typeof window === 'undefined') return false
  const standalone = window.matchMedia('(display-mode: standalone)').matches
  // iOS Safari exposes its own private flag for "added to home screen".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iosStandalone = (navigator as any).standalone === true
  return standalone || iosStandalone
}

export interface UseInstallPromptResult {
  browserSupport: BrowserSupport
  /** Whether the dialog currently has anything actionable to show. */
  readyToShow: boolean
  /** Whether the dialog is currently open. */
  isOpen: boolean
  /** Open the dialog (no-op if `readyToShow` is false). */
  open: () => void
  /** Close the dialog without recording any dismissal state. */
  close: () => void
  /** "Remind me later" — 24h cooldown via localStorage. */
  remindLater: () => void
  /** "Don't show again" — permanent suppression via localStorage. */
  dismiss: () => void
  /** Trigger the deferred prompt (native-install only). Resolves to the user choice. */
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
}

/**
 * Drives the install promotion dialog. Combines:
 * - UA-based browser support detection
 * - The `beforeinstallprompt` / `appinstalled` window events
 * - The current display mode (already-installed check)
 * - Two localStorage flags for the user's dismiss / remind preferences
 *
 * The hook never opens the dialog itself; it exposes `readyToShow` so the
 * component can decide when (and whether) to pop it.
 */
export function useInstallPrompt(): UseInstallPromptResult {
  const browserSupport = detectBrowserSupport()
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState<boolean>(readInstalled)
  const [dismissed, setDismissed] = useState<boolean>(readDismissed)
  const [remindAt, setRemindAt] = useState<number | null>(readRemindAt)
  const [isOpen, setIsOpen] = useState(false)

  // beforeinstallprompt only ever fires on Chromium-class browsers.
  // We also listen for `appinstalled` so we can clear any persisted
  // dismissal state when the user installs from the browser UI directly.
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }
    const handleAppInstalled = () => {
      setInstalled(true)
      setDeferredPrompt(null)
      try {
        localStorage.removeItem(DISMISS_KEY)
        localStorage.removeItem(REMIND_KEY)
      } catch {
        // localStorage may be unavailable (e.g. disabled cookies); not fatal.
      }
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      )
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  // Drive auto-open: when conditions first become favourable, schedule the
  // dialog to open after a brief delay so the page has time to settle.
  // Re-runs whenever any gate flips on.
  const inRemindLater =
    remindAt !== null && Date.now() < remindAt ? remindAt : null

  const readyToShow =
    browserSupport !== 'unsupported' &&
    !installed &&
    !dismissed &&
    inRemindLater === null &&
    // For native install we wait for `beforeinstallprompt` to fire before
    // showing anything — without it the Install button has nothing to do.
    (browserSupport !== 'native-install' || deferredPrompt !== null)

  // Auto-close: when conditions flip off (install completes, user dismisses,
  // remind-later kicks in, …) the open dialog must follow.
  useEffect(() => {
    if (!readyToShow && isOpen) {
      setIsOpen(false)
    }
  }, [readyToShow, isOpen])

  const open = useCallback(() => {
    if (!readyToShow) return
    setIsOpen(true)
  }, [readyToShow])

  const close = useCallback(() => setIsOpen(false), [])

  const install = useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'unavailable'
  > => {
    if (!deferredPrompt) return 'unavailable'
    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    if (choice.outcome === 'accepted') {
      setInstalled(true)
    }
    return choice.outcome
  }, [deferredPrompt])

  const remindLater = useCallback(() => {
    const next = Date.now() + REMIND_DELAY_MS
    try {
      localStorage.setItem(REMIND_KEY, new Date(next).toISOString())
    } catch {
      // localStorage may be disabled; the in-memory state still applies.
    }
    setRemindAt(next)
    setIsOpen(false)
  }, [])

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, 'true')
    } catch {
      // ignore
    }
    setDismissed(true)
    setIsOpen(false)
  }, [])

  return {
    browserSupport,
    readyToShow,
    isOpen,
    open,
    close,
    remindLater,
    dismiss,
    install,
  }
}

/**
 * Helper used by tests to introspect / reset the auto-open delay without
 * importing internal module state.
 */
export const INSTALL_PROMPT_TIMING = {
  AUTO_OPEN_DELAY_MS,
} as const
