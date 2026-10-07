import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { INSTALL_PROMPT_TIMING } from '@/lib/use-install-prompt'

import { makePwaInstallService, type PromotionGates } from './pwa-install'

// Authoring gate (test-audit): this file owns the install service boundary —
// eligibility comes only from explicit auth successes (never restored
// sessions), auto-promotion gates on redirects/visibility/idle/work, the
// 7-day cooldown and permanent dismissal suppress while the manual helper
// bypasses them, installed suppresses one-way, and the activation boundary
// keeps prompt() in the gesture with the service adopting only the outcome.
// Regression: restored-session eligibility would nag every remembered login;
// a prompt invoked after async scheduling would be rejected by the browser;
// a cooldown applied to manual opens would strand the menu helper.
// Browser detection, timing constants, and the thin hook binding stay owned
// by use-install-prompt.test.tsx; this file owns the Effect service around
// them (capture, eligibility, gating, suppression, activation boundary).
// Memory stores are the production constructor parameters.

const CHROMIUM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

function memoryStore() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) =>
      data.has(key) ? (data.get(key) as string) : null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
}

function harness(overrides?: Parameters<typeof makePwaInstallService>[0]) {
  const listeners = new Map<string, Set<(event: Event) => void>>()
  const eventSource = {
    addEventListener: (type: string, listener: (event: Event) => void) => {
      let set = listeners.get(type)
      if (!set) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(listener)
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      listeners.get(type)?.delete(listener)
    },
  }
  const service = makePwaInstallService({
    userAgent: CHROMIUM_UA,
    sessionStore: memoryStore(),
    localStore: memoryStore(),
    readInstalled: () => false,
    eventSource,
    now: () => 1_000_000,
    ...overrides,
  })
  const emit = (type: string, event: Event = new Event(type)) => {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }
  return { service, emit, listeners }
}

const OPEN_GATES: PromotionGates = {
  redirectsSettled: true,
  visible: true,
  lastActivityAt: 0,
  blockedByWork: false,
  onboardingActive: false,
}

describe('eligibility', () => {
  it('stays ineligible until an explicit auth success marks the tab', async () => {
    const { service } = harness()
    await Effect.runPromise(service.start)
    expect(await Effect.runPromise(service.readyToShow)).toBe(false)
    await Effect.runPromise(service.markEligible)
    expect(await Effect.runPromise(service.readyToShow)).toBe(false)
    await Effect.runPromise(service.stop)
  })

  it('never inherits eligibility from another tab store', async () => {
    const first = makePwaInstallService({
      userAgent: CHROMIUM_UA,
      sessionStore: memoryStore(),
      localStore: memoryStore(),
      readInstalled: () => false,
      eventSource: null,
    })
    await Effect.runPromise(first.markEligible)
    const second = makePwaInstallService({
      userAgent: CHROMIUM_UA,
      sessionStore: memoryStore(),
      localStore: memoryStore(),
      readInstalled: () => false,
      eventSource: null,
    })
    expect((await Effect.runPromise(second.snapshot)).eligible).toBe(false)
  })
})

describe('promotion gating', () => {
  it('promotes after redirects settle with visible idle and no blockers', async () => {
    const { service, emit } = harness()
    await Effect.runPromise(service.start)
    await Effect.runPromise(service.markEligible)
    emit('beforeinstallprompt')
    expect(await Effect.runPromise(service.readyToShow)).toBe(true)
    expect(await Effect.runPromise(service.shouldPromote(OPEN_GATES))).toBe(
      true,
    )
    await Effect.runPromise(service.stop)
  })

  it('withholds promotion while hidden, active, blocked, or onboarding', async () => {
    const { service, emit } = harness()
    await Effect.runPromise(service.start)
    await Effect.runPromise(service.markEligible)
    emit('beforeinstallprompt')
    const cases: PromotionGates[] = [
      { ...OPEN_GATES, redirectsSettled: false },
      { ...OPEN_GATES, visible: false },
      { ...OPEN_GATES, lastActivityAt: 999_999 },
      { ...OPEN_GATES, blockedByWork: true },
      { ...OPEN_GATES, onboardingActive: true },
    ]
    for (const gates of cases) {
      expect(await Effect.runPromise(service.shouldPromote(gates))).toBe(false)
    }
    await Effect.runPromise(service.stop)
  })
})

describe('suppression and manual helper', () => {
  it('honors the 7-day dismissal while the manual helper bypasses it', async () => {
    const localStore = memoryStore()
    const { service, emit } = harness({ localStore })
    await Effect.runPromise(service.start)
    await Effect.runPromise(service.markEligible)
    emit('beforeinstallprompt')
    await Effect.runPromise(service.remindLater)
    expect(await Effect.runPromise(service.readyToShow)).toBe(false)
    const stored = localStore.getItem('spliit-pwa-install-remind-at')
    expect(Date.parse(stored as string) - 1_000_000).toBe(
      INSTALL_PROMPT_TIMING.REMIND_DELAY_MS,
    )
    await Effect.runPromise(service.openManual)
    expect((await Effect.runPromise(service.snapshot)).isOpen).toBe(true)
    await Effect.runPromise(service.stop)
  })

  it('honors permanent dismissal', async () => {
    const { service, emit } = harness()
    await Effect.runPromise(service.start)
    await Effect.runPromise(service.markEligible)
    emit('beforeinstallprompt')
    await Effect.runPromise(service.dismiss)
    expect(await Effect.runPromise(service.readyToShow)).toBe(false)
    await Effect.runPromise(service.stop)
  })

  it('suppresses one-way once installed and clears flags', async () => {
    let installed = false
    const { service, emit } = harness({ readInstalled: () => installed })
    await Effect.runPromise(service.start)
    await Effect.runPromise(service.markEligible)
    emit('beforeinstallprompt')
    installed = true
    emit('appinstalled')
    const snapshot = await Effect.runPromise(service.snapshot)
    expect(snapshot.installed).toBe(true)
    expect(await Effect.runPromise(service.readyToShow)).toBe(false)
    await Effect.runPromise(service.openManual)
    expect((await Effect.runPromise(service.snapshot)).isOpen).toBe(false)
    await Effect.runPromise(service.stop)
  })
})

describe('activation boundary', () => {
  it('exposes the prompt for direct gesture invocation and adopts the outcome', async () => {
    const { service, emit } = harness()
    await Effect.runPromise(service.start)
    await Effect.runPromise(service.markEligible)
    expect(service.takePromptForGesture()).toBe(null)
    const event = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>
    }
    let prompted = false
    event.prompt = () => {
      prompted = true
      return Promise.resolve()
    }
    emit('beforeinstallprompt', event)
    const taken = service.takePromptForGesture()
    expect(taken).toBe(event)
    await taken?.prompt()
    expect(prompted).toBe(true)
    await Effect.runPromise(service.reportPromptOutcome('accepted'))
    expect((await Effect.runPromise(service.snapshot)).installed).toBe(true)
    expect(service.takePromptForGesture()).toBe(null)
    await Effect.runPromise(service.stop)
  })

  it('cools down a native dismissal like Not now', async () => {
    const { service, emit } = harness()
    await Effect.runPromise(service.start)
    await Effect.runPromise(service.markEligible)
    emit('beforeinstallprompt')
    await Effect.runPromise(service.reportPromptOutcome('dismissed'))
    expect(await Effect.runPromise(service.readyToShow)).toBe(false)
    await Effect.runPromise(service.openManual)
    expect((await Effect.runPromise(service.snapshot)).isOpen).toBe(true)
    await Effect.runPromise(service.stop)
  })

  it('releases capture listeners on stop', async () => {
    const { service, listeners } = harness()
    await Effect.runPromise(service.start)
    expect(listeners.get('beforeinstallprompt')?.size).toBe(1)
    await Effect.runPromise(service.stop)
    expect(listeners.get('beforeinstallprompt')?.size).toBe(0)
  })
})
