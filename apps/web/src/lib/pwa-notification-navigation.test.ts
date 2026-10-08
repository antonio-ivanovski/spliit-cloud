import { describe, expect, it, vi } from 'vitest'

import { startNotificationNavigation } from './pwa-notification-navigation'
import {
  SPLIIT_NOTIFICATION_ACK,
  SPLIIT_NOTIFICATION_NAVIGATE,
} from './pwa-notification-protocol'

function serviceWorkerHarness() {
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  return {
    addEventListener: vi.fn(
      (type: string, listener: (event: unknown) => void) => {
        const set = listeners.get(type) ?? new Set()
        set.add(listener)
        listeners.set(type, set)
      },
    ),
    removeEventListener: vi.fn(
      (type: string, listener: (event: unknown) => void) => {
        listeners.get(type)?.delete(listener)
      },
    ),
    emitMessage: (data: unknown, ports: MessagePort[] = []) => {
      for (const listener of listeners.get('message') ?? []) {
        listener({ data, ports } as unknown as MessageEvent)
      }
    },
  }
}

function navigateRequest(url: string, notificationId = 'n1') {
  return {
    type: SPLIIT_NOTIFICATION_NAVIGATE,
    protocol: 1,
    url,
    notificationId,
  }
}

describe('notification navigation (page side)', () => {
  it('navigates same-origin targets only when safe, then acks', () => {
    const container = serviceWorkerHarness()
    const navigate = vi.fn()
    const posted: unknown[] = []
    const port = {
      postMessage: vi.fn((message: unknown) => posted.push(message)),
    }
    const stop = startNotificationNavigation({
      serviceWorker: container,
      navigate,
      hasBlockers: () => false,
      getOrigin: () => 'https://app.test',
    })
    container.emitMessage(navigateRequest('/groups/g1?tab=a'), [port as never])
    expect(navigate).toHaveBeenCalledWith('/groups/g1?tab=a')
    expect(posted).toEqual([
      expect.objectContaining({
        type: SPLIIT_NOTIFICATION_ACK,
        notificationId: 'n1',
        status: 'navigated',
      }),
    ])
    stop()
    expect(container.removeEventListener).toHaveBeenCalled()
  })

  it('refuses blocked documents and cross-origin targets', () => {
    const container = serviceWorkerHarness()
    const navigate = vi.fn()
    const posted: unknown[] = []
    const port = {
      postMessage: vi.fn((message: unknown) => posted.push(message)),
    }
    startNotificationNavigation({
      serviceWorker: container,
      navigate,
      hasBlockers: () => true,
      getOrigin: () => 'https://app.test',
    })
    container.emitMessage(navigateRequest('/groups/g1'), [port as never])
    expect(navigate).not.toHaveBeenCalled()
    expect(posted).toEqual([expect.objectContaining({ status: 'blocked' })])
    container.emitMessage(navigateRequest('https://evil.test/x'), [
      port as never,
    ])
    // Cross-origin input degrades to '/' but a blocked tab still refuses.
    expect(navigate).not.toHaveBeenCalled()
    expect(posted).toHaveLength(2)
  })

  it('ignores foreign messages and missing workers', () => {
    const container = serviceWorkerHarness()
    const navigate = vi.fn()
    startNotificationNavigation({
      serviceWorker: container,
      navigate,
      hasBlockers: () => false,
    })
    container.emitMessage({ type: 'SOMETHING_ELSE' })
    container.emitMessage(null)
    expect(navigate).not.toHaveBeenCalled()
    expect(
      startNotificationNavigation({ navigate, hasBlockers: () => false }),
    ).toEqual(expect.any(Function))
  })
})
