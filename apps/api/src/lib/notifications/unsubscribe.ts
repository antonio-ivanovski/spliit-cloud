import {
  notificationCategorySchema,
  type NotificationCategory,
} from '@spliit/domain/notifications'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getApiBaseUrl } from '../auth/urls'
import { env } from '../env'

const AUDIENCE = 'spliit:email-unsubscribe'
const VERSION = 'v1'
const MAX_TOKEN_LENGTH = 4096
const leafCategorySchema = notificationCategorySchema

type Key = { kid: string; secret: Buffer }
export type EmailUnsubscribeClaims = {
  aud: typeof AUDIENCE
  accountId: string
  category: NotificationCategory
  iat: number
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function keyRing(): Key[] {
  const raw = env.NOTIFICATION_UNSUBSCRIBE_KEYS ?? ''
  return raw
    .split(',')
    .map((rawEntry) => {
      const entry = rawEntry.trim()
      const separator = entry.indexOf(':')
      if (separator <= 0) return null
      const kid = entry.slice(0, separator)
      const encoded = entry.slice(separator + 1)
      if (
        !/^[A-Za-z0-9_-]{1,64}$/.test(kid) ||
        !/^[A-Za-z0-9_-]+$/.test(encoded)
      )
        return null
      const secret = decodeBase64Url(encoded)
      return secret.length >= 32 ? { kid, secret } : null
    })
    .filter((key): key is Key => key !== null)
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function mac(input: string, secret: Buffer): Buffer {
  return createHmac('sha256', secret).update(input).digest()
}

export function createEmailUnsubscribeToken(input: {
  accountId: string
  category: NotificationCategory
  now?: number
}): string {
  const [key] = keyRing()
  if (!key) throw new Error('NOTIFICATION_UNSUBSCRIBE_KEYS is not configured')
  const category = leafCategorySchema.parse(input.category)
  const payload = encode(
    JSON.stringify({
      aud: AUDIENCE,
      accountId: input.accountId,
      category,
      iat: input.now ?? Math.floor(Date.now() / 1000),
    } satisfies EmailUnsubscribeClaims),
  )
  const envelope = `${VERSION}.${key.kid}.${payload}`
  return `${envelope}.${encode(mac(envelope, key.secret))}`
}

export function getEmailUnsubscribeUrl(input: {
  accountId: string
  category: NotificationCategory
  now?: number
}): string {
  const token = createEmailUnsubscribeToken(input)
  return `${getApiBaseUrl()}/email/unsubscribe?token=${encodeURIComponent(token)}`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }
    return entities[character]!
  })
}

/** Build controlled headers and a small visible footer for optional email. */
export function buildEmailUnsubscribeMetadata(input: {
  accountId: string
  category: NotificationCategory
}): {
  url: string
  headers: { 'List-Unsubscribe': string; 'List-Unsubscribe-Post': string }
  textFooter: string
  htmlFooter: string
} | null {
  try {
    const url = getEmailUnsubscribeUrl(input)
    const safeUrl = escapeHtml(url)
    const label = input.category.toLowerCase().replaceAll('_', ' ')
    return {
      url,
      headers: {
        'List-Unsubscribe': `<${url}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      textFooter: `\n\nUnsubscribe from ${label} email notifications: ${url}`,
      htmlFooter: `<p style="color:#64748b;font-size:13px"><a href="${safeUrl}">Unsubscribe from ${escapeHtml(label)} email notifications</a></p>`,
    }
  } catch {
    return null
  }
}

export function verifyEmailUnsubscribeToken(
  token: string | null | undefined,
): EmailUnsubscribeClaims | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null
  const parts = token.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) return null
  const [, kid, payload, signature] = parts
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(kid)) return null
  const key = keyRing().find((candidate) => candidate.kid === kid)
  if (!key) return null
  let supplied: Buffer
  try {
    supplied = decodeBase64Url(signature)
  } catch {
    return null
  }
  const expected = mac(`${VERSION}.${kid}.${payload}`, key.secret)
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return null
  }
  try {
    const claims = JSON.parse(
      decodeBase64Url(payload).toString('utf8'),
    ) as EmailUnsubscribeClaims
    if (
      claims.aud !== AUDIENCE ||
      typeof claims.accountId !== 'string' ||
      !claims.accountId ||
      typeof claims.iat !== 'number' ||
      !Number.isSafeInteger(claims.iat) ||
      !leafCategorySchema.safeParse(claims.category).success
    ) {
      return null
    }
    return claims
  } catch {
    return null
  }
}
