import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import type { NotificationNavigationDeps } from '@/lib/pwa-notification-navigation'
import {
  PWA_NOTIFICATION_PROTOCOL_VERSION,
  SPLIIT_NOTIFICATION_ACK,
  SPLIIT_NOTIFICATION_NAVIGATE,
} from '@/lib/pwa-notification-protocol'

import {
  makePwaNotificationService,
  type NotificationClickDeps,
} from './pwa-notifications'

// Authoring gate (test-audit): this file owns the notification service
// boundary — the page subscription counts accepted/refused requests and
// releases on stop, and the worker-side click flow never blindly navigates
// an existing document (blocked/timeout opens a fresh window; cross-origin
// targets sanitize to same-origin). Regression: a leaked page subscription
// would double-handle worker messages after HMR; a click that navigated the
// asking window on blocked/timeout would yank the user's open document.
// Ack validation, the 2s deadline, and focus/ask/open decisions inside the
// protocol module are owned by pwa-notification-protocol.test.ts; this file
// owns the Effect service around them. Stubs are the production constructor
// parameters.

const ORIGIN = 'https://app.example'

function pageHarness(overrides?: { readonly blocked?: boolean }) {
  const navigated: string[] = []
  const posted: unknown[] = []
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  const container = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      let set = listeners.get(type)
      if (!set) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(listener)
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.get(type)?.delete(listener)
    },
  }
  const service = makePwaNotificationService({
    serviceWorker:
      container as unknown as NotificationNavigationDeps['serviceWorker'],
    navigate: (url: string) => {
      navigated.push(url)
    },
    hasBlockers: () => overrides?.blocked ?? false,
    getOrigin: () => ORIGIN,
  })
  const emitRequest = (url: string, notificationId = 'n-1') => {
    const port = {
      postMessage: (data: unknown) => {
        posted.push(data)
      },
    }
    for (const listener of listeners.get('message') ?? []) {
      listener({
        data: {
          type: SPLIIT_NOTIFICATION_NAVIGATE,
          protocol: PWA_NOTIFICATION_PROTOCOL_VERSION,
          url,
          notificationId,
        },
        ports: [port],
      })
    }
  }
  return { service, navigated, posted, emitRequest, listeners }
}

function clickHarness(
  overrides?: Partial<NotificationClickDeps> & {
    readonly windows?: Array<{ id: string; url: string }>
    readonly verdict?: 'navigated' | 'blocked' | 'timeout'
  },
) {
  const focused: string[] = []
  const opened: string[] = []
  const asked: string[] = []
  const windows = (overrides?.windows ?? []).map((entry) => ({
    ...entry,
    focus: () => {
      focused.push(entry.id)
      return Promise.resolve()
    },
  }))
  const deps: NotificationClickDeps = {
    matchAllWindows:
      overrides?.matchAllWindows ?? (() => Promise.resolve(windows)),
    openWindow:
      overrides?.openWindow ??
      ((url) => {
        opened.push(url)
        return Promise.resolve()
      }),
    requestNavigation:
      overrides?.requestNavigation ??
      ((clientId) => {
        asked.push(clientId)
        return Promise.resolve(overrides?.verdict ?? 'navigated')
      }),
  }
  return { deps, focused, opened, asked }
}

describe('page navigation subscription', () => {
  it('acks navigated on clean pages and counts it', async () => {
    const { service, navigated, posted, emitRequest, listeners } = pageHarness()
    await Effect.runPromise(service.start)
    await Effect.runPromise(service.start)
    expect(listeners.get('message')?.size).toBe(1)
    emitRequest('/groups/g1')
    expect(navigated).toEqual(['/groups/g1'])
    expect(posted).toEqual([
      {
        type: SPLIIT_NOTIFICATION_ACK,
        protocol: PWA_NOTIFICATION_PROTOCOL_VERSION,
        notificationId: 'n-1',
        status: 'navigated',
      },
    ])
    const snapshot = await Effect.runPromise(service.snapshot)
    expect(snapshot.accepted).toBe(1)
    expect(snapshot.refused).toBe(0)
    await Effect.runPromise(service.stop)
    expect((await Effect.runPromise(service.snapshot)).active).toBe(false)
    expect(listeners.get('message')?.size).toBe(0)
  })

  it('acks blocked when unfinished work is open and never navigates', async () => {
    const { service, navigated, posted, emitRequest } = pageHarness({
      blocked: true,
    })
    await Effect.runPromise(service.start)
    emitRequest('/groups/g1')
    expect(navigated).toEqual([])
    expect(posted).toEqual([
      {
        type: SPLIIT_NOTIFICATION_ACK,
        protocol: PWA_NOTIFICATION_PROTOCOL_VERSION,
        notificationId: 'n-1',
        status: 'blocked',
      },
    ])
    const snapshot = await Effect.runPromise(service.snapshot)
    expect(snapshot.accepted).toBe(0)
    expect(snapshot.refused).toBe(1)
    await Effect.runPromise(service.stop)
  })
})

describe('worker click flow', () => {
  it('focuses a window already showing the target', async () => {
    const { deps, focused, opened, asked } = clickHarness({
      windows: [{ id: 'w-1', url: ORIGIN + '/groups/g1' }],
    })
    const service = makePwaNotificationService({ navigate: () => {} })
    const outcome = await Effect.runPromise(
      service.handleClick(
        { targetUrl: '/groups/g1', origin: ORIGIN, notificationId: 'n-1' },
        deps,
      ),
    )
    expect(outcome).toEqual({ handled: 'focused' })
    expect(focused).toEqual(['w-1'])
    expect(opened).toEqual([])
    expect(asked).toEqual([])
  })

  it('asks one window to navigate when safe and opens nothing', async () => {
    const { deps, opened, asked } = clickHarness({
      windows: [{ id: 'w-1', url: ORIGIN + '/' }],
      verdict: 'navigated',
    })
    const service = makePwaNotificationService({ navigate: () => {} })
    const outcome = await Effect.runPromise(
      service.handleClick(
        { targetUrl: '/groups/g2', origin: ORIGIN, notificationId: 'n-2' },
        deps,
      ),
    )
    expect(outcome).toEqual({ handled: 'navigated' })
    expect(asked).toEqual(['w-1'])
    expect(opened).toEqual([])
  })

  it('opens a fresh window on blocked and on timeout, never navigating', async () => {
    for (const verdict of ['blocked', 'timeout'] as const) {
      const pageNavigations: string[] = []
      const { deps, opened } = clickHarness({
        windows: [{ id: 'w-1', url: ORIGIN + '/expenses/e1?edit=1' }],
        verdict,
      })
      const service = makePwaNotificationService({
        navigate: (url) => {
          pageNavigations.push(url)
        },
      })
      const outcome = await Effect.runPromise(
        service.handleClick(
          { targetUrl: '/groups/g9', origin: ORIGIN, notificationId: 'n-3' },
          deps,
        ),
      )
      expect(outcome).toEqual({ handled: 'opened-fallback' })
      expect(opened).toEqual(['/groups/g9'])
      expect(pageNavigations).toEqual([])
    }
  })

  it('sanitizes cross-origin deep links to same-origin paths', async () => {
    const { deps, opened } = clickHarness({ windows: [] })
    const service = makePwaNotificationService({ navigate: () => {} })
    const outcome = await Effect.runPromise(
      service.handleClick(
        {
          targetUrl: 'https://evil.example/phish',
          origin: ORIGIN,
          notificationId: 'n-4',
        },
        deps,
      ),
    )
    expect(outcome).toEqual({ handled: 'opened' })
    expect(opened).toEqual(['/'])
  })

  it('resolves the fallback instead of rejecting when opening fails', async () => {
    const { deps } = clickHarness({
      windows: [],
      openWindow: () => Promise.reject(new Error('popup blocked')),
    })
    const service = makePwaNotificationService({ navigate: () => {} })
    const outcome = await Effect.runPromise(
      service.handleClick(
        { targetUrl: '/groups/g1', origin: ORIGIN, notificationId: 'n-5' },
        deps,
      ),
    )
    expect(outcome).toEqual({ handled: 'opened-fallback' })
  })
})
