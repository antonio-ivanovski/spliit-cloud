import type { Context } from 'hono'
import { removeEmailPreference } from '../lib/notifications/preferences'
import { verifyEmailUnsubscribeToken } from '../lib/notifications/unsubscribe'

function secureHeaders(c: Context) {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Robots-Tag', 'noindex, nofollow')
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'",
  )
}

function tokenFrom(c: Context): string | null {
  return c.req.query('token') ?? null
}

export async function emailUnsubscribeGet(c: Context) {
  secureHeaders(c)
  const claims = verifyEmailUnsubscribeToken(tokenFrom(c))
  if (!claims) return c.text('Invalid unsubscribe link', 400)
  const label = claims.category.toLowerCase().replaceAll('_', ' ')
  return c.html(
    `<!doctype html><meta charset="utf-8"><title>Unsubscribe</title>` +
      `<meta name="referrer" content="no-referrer"><p>Remove ${label} email notifications?</p>` +
      `<form method="post" action="/email/unsubscribe?token=${encodeURIComponent(tokenFrom(c) as string)}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Unsubscribe</button></form>`,
  )
}

export async function emailUnsubscribePost(c: Context) {
  secureHeaders(c)
  const claims = verifyEmailUnsubscribeToken(tokenFrom(c))
  if (!claims) return c.text('Invalid unsubscribe link', 400)
  const contentType = c.req
    .header('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase()
  let oneClick = false
  if (contentType === 'application/x-www-form-urlencoded') {
    oneClick = (await c.req.text()) === 'List-Unsubscribe=One-Click'
  } else if (contentType === 'multipart/form-data') {
    const body = await c.req.parseBody()
    oneClick = body['List-Unsubscribe'] === 'One-Click'
  }
  if (!oneClick) return c.text('Invalid one-click request', 400)
  await removeEmailPreference(claims.accountId, claims.category)
  // RFC 8058 requires a successful one-click response with no redirect.
  return c.body(null, 204)
}
