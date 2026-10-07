import { describe, expect, it, vi } from 'vitest'

import {
  NOTIFICATION_NAV_ACK_TIMEOUT_MS,
  SPLIIT_NOTIFICATION_ACK,
  asNotificationAck,
  chooseNotificationClient,
  runNotificationClickFlow,
  toSameOriginPath,
  waitForNavigationAck,
} from './pwa-notification-protocol'

describe('notification navigation protocol', () => {
  it('keeps navigation same-origin', () => {
    expect(toSameOriginPath('/groups/g1?tab=a', 'https://app.test')).toBe(
      '/groups/g1?tab=a',
    )
    expect(toSameOriginPath('https://evil.test/x', 'https://app.test')).toBe(
      '/',
    )
    expect(toSameOriginPath('https://[::1', 'https://app.test')).toBe('/')
  })

  it('focuses an already-target window, asks otherwise, opens when alone', () => {
    const clients = [
      { id: 'a', url: 'https://app.test/groups/g1' },
      { id: 'b', url: 'https://app.test/groups/g2' },
    ]
    expect(chooseNotificationClient(clients, '/groups/g2')).toEqual({
      action: 'focus',
      clientId: 'b',
    })
    expect(chooseNotificationClient(clients, '/groups/g9')).toEqual({
      action: 'ask',
      clientId: 'a',
    })
    expect(chooseNotificationClient([], '/groups/g9')).toEqual({
      action: 'open',
    })
  })

  it('validates acks by id and status', () => {
    const ack = (status: string, id = 'n1') => ({
      type: SPLIIT_NOTIFICATION_ACK,
      protocol: 1,
      notificationId: id,
      status,
    })
    expect(asNotificationAck(ack('navigated'), 'n1')).toBe('navigated')
    expect(asNotificationAck(ack('blocked'), 'n1')).toBe('blocked')
    expect(asNotificationAck(ack('navigated', 'n2'), 'n1')).toBeNull()
    expect(asNotificationAck(ack('maybe'), 'n1')).toBeNull()
    expect(asNotificationAck(null, 'n1')).toBeNull()
  })

  it('times out a silent page', async () => {
    vi.useFakeTimers()
    try {
      const pending = waitForNavigationAck(() => () => {}, 'n1', {
        timeoutMs: NOTIFICATION_NAV_ACK_TIMEOUT_MS,
      })
      await vi.advanceTimersByTimeAsync(NOTIFICATION_NAV_ACK_TIMEOUT_MS)
      await expect(pending).resolves.toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('focuses matching windows without messaging the app', async () => {
    const focus = vi.fn().mockResolvedValue(undefined)
    const requestNavigation = vi.fn()
    const openWindow = vi.fn()
    const outcome = await runNotificationClickFlow(
      {
        matchAllWindows: async () => [
          { id: 'a', url: 'https://app.test/groups/g1', focus },
        ],
        openWindow,
        requestNavigation,
      },
      { targetPath: '/groups/g1', notificationId: 'n1' },
    )
    expect(outcome).toEqual({ handled: 'focused' })
    expect(focus).toHaveBeenCalledOnce()
    expect(requestNavigation).not.toHaveBeenCalled()
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('opens a fresh window when the app refuses or stays silent', async () => {
    const ask = (verdict: 'blocked' | 'timeout') => ({
      matchAllWindows: async () => [
        {
          id: 'a',
          url: 'https://app.test/',
          focus: vi.fn(),
        },
      ],
      openWindow: vi.fn(),
      requestNavigation: vi.fn().mockResolvedValue(verdict),
    })
    for (const verdict of ['blocked', 'timeout'] as const) {
      const deps = ask(verdict)
      const outcome = await runNotificationClickFlow(deps, {
        targetPath: '/groups/g9',
        notificationId: 'n1',
      })
      expect(outcome).toEqual({ handled: 'opened-fallback' })
      expect(deps.openWindow).toHaveBeenCalledWith('/groups/g9')
    }
  })

  it('accepts an app navigation without opening a window', async () => {
    const openWindow = vi.fn()
    const outcome = await runNotificationClickFlow(
      {
        matchAllWindows: async () => [
          {
            id: 'a',
            url: 'https://app.test/',
            focus: vi.fn(),
          },
        ],
        openWindow,
        requestNavigation: vi.fn().mockResolvedValue('navigated'),
      },
      { targetPath: '/groups/g9', notificationId: 'n1' },
    )
    expect(outcome).toEqual({ handled: 'navigated' })
    expect(openWindow).not.toHaveBeenCalled()
  })
})
