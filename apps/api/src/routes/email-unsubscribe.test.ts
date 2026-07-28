import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import '../test/mocks'
import type {
  emailUnsubscribeGet as EmailUnsubscribeGet,
  emailUnsubscribePost as EmailUnsubscribePost,
} from './email-unsubscribe'

vi.mock('../lib/notifications/preferences', () => ({
  removeEmailPreference: vi.fn(async () => undefined),
}))

async function loadRouteModules() {
  vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'e'.repeat(32))
  vi.resetModules()
  return {
    ...(await import('../lib/notifications/unsubscribe')),
    ...(await import('./email-unsubscribe')),
  }
}

function routeApp(route: {
  emailUnsubscribeGet?: typeof EmailUnsubscribeGet
  emailUnsubscribePost?: typeof EmailUnsubscribePost
}) {
  const app = new Hono()
  if (route.emailUnsubscribeGet) {
    app.get('/email/unsubscribe', route.emailUnsubscribeGet)
  }
  if (route.emailUnsubscribePost) {
    app.post('/email/unsubscribe', route.emailUnsubscribePost)
  }
  return app
}

describe('email unsubscribe routes', () => {
  it('redirects a valid GET to the web preview route', async () => {
    const { createEmailUnsubscribeToken, emailUnsubscribeGet } =
      await loadRouteModules()
    const token = await createEmailUnsubscribeToken({
      accountId: 'acct-1',
      category: 'EXPENSE_CHANGED',
    })

    const response = await routeApp({ emailUnsubscribeGet }).request(
      `/email/unsubscribe?token=${encodeURIComponent(token)}`,
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      `http://localhost:3000/unsubscribe#token=${encodeURIComponent(token)}`,
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    vi.unstubAllEnvs()
  })

  it('rejects an invalid GET without redirecting', async () => {
    const { emailUnsubscribeGet } = await loadRouteModules()
    const response = await routeApp({ emailUnsubscribeGet }).request(
      '/email/unsubscribe?token=invalid',
    )

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Invalid unsubscribe link')
    expect(response.headers.get('cache-control')).toBe('no-store')
    vi.unstubAllEnvs()
  })

  it('keeps RFC 8058 one-click POST semantics', async () => {
    const { createEmailUnsubscribeToken, emailUnsubscribePost } =
      await loadRouteModules()
    const token = await createEmailUnsubscribeToken({
      accountId: 'acct-1',
      category: 'EXPENSE_CHANGED',
    })

    const response = await routeApp({ emailUnsubscribePost }).request(
      `/email/unsubscribe?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      },
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('location')).toBeNull()
    vi.unstubAllEnvs()
  })
})
