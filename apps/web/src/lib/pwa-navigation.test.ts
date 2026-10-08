import { describe, expect, it } from 'vitest'

import { shouldUseAppShellNavigation } from '@/lib/pwa-navigation'
import { toSameOriginPath } from '@/lib/pwa-notification-protocol'

describe('shouldUseAppShellNavigation', () => {
  it('serves the SPA shell for app routes', () => {
    expect(shouldUseAppShellNavigation('/')).toBe(true)
    expect(shouldUseAppShellNavigation('/groups/abc')).toBe(true)
    expect(shouldUseAppShellNavigation('/groups/abc/expenses?q=1')).toBe(true)
    expect(shouldUseAppShellNavigation('/auth/forgot-password')).toBe(true)
    expect(shouldUseAppShellNavigation('/auth/reset-password')).toBe(true)
    expect(shouldUseAppShellNavigation('/auth/complete-profile')).toBe(true)
    expect(shouldUseAppShellNavigation('/auth/recover')).toBe(true)
    expect(shouldUseAppShellNavigation('/auth/forgot-password?email=a')).toBe(
      true,
    )
    expect(shouldUseAppShellNavigation('/oauth/login')).toBe(true)
  })

  it('lets API and worker document requests fall through', () => {
    expect(shouldUseAppShellNavigation('/sw.js')).toBe(false)
    expect(shouldUseAppShellNavigation('/sw.js?v=1')).toBe(false)
    expect(shouldUseAppShellNavigation('/manifest.webmanifest')).toBe(false)
    expect(shouldUseAppShellNavigation('/trpc/overview.get')).toBe(false)
    expect(shouldUseAppShellNavigation('/health')).toBe(false)
    expect(shouldUseAppShellNavigation('/email/unsubscribe')).toBe(false)
    expect(shouldUseAppShellNavigation('/openapi.json')).toBe(false)
    expect(shouldUseAppShellNavigation('/docs')).toBe(false)
    expect(
      shouldUseAppShellNavigation('/.well-known/oauth-authorization-server'),
    ).toBe(false)
    expect(shouldUseAppShellNavigation('/groups/abc/expenses/export/csv')).toBe(
      false,
    )
    expect(shouldUseAppShellNavigation('/auth')).toBe(false)
    expect(shouldUseAppShellNavigation('/auth/callback/google?code=1')).toBe(
      false,
    )
    expect(shouldUseAppShellNavigation('/auth/sign-in/email')).toBe(false)
  })

  it('serves notification deep links from the app shell offline', () => {
    // Push payload URLs resolve same-origin, then hit the cached shell:
    // cold offline launches land in-app instead of a browser error page.
    const targets = [
      '/groups/abc',
      '/groups/abc/expenses/exp-1',
      '/groups/abc/balances',
      '/expenses',
    ]
    for (const target of targets) {
      const path = toSameOriginPath(target, 'https://app.test')
      expect(shouldUseAppShellNavigation(path)).toBe(true)
    }
  })
})
