import {
  notificationCategorySchema,
  type NotificationCategory,
} from '@spliit/domain/notifications'
import { Jwt } from 'hono/utils/jwt'
import { getApiBaseUrl } from '../auth/urls'
import { env } from '../env'

const AUDIENCE = 'spliit:email-unsubscribe'
const MAX_TOKEN_LENGTH = 4096
const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60
const leafCategorySchema = notificationCategorySchema

export type EmailUnsubscribeClaims = {
  aud: typeof AUDIENCE
  accountId: string
  category: NotificationCategory
  iat: number
  exp: number
}

function unsubscribeSecret(): string {
  const secret = env.EMAIL_UNSUBSCRIBE_SECRET
  if (!secret) throw new Error('EMAIL_UNSUBSCRIBE_SECRET is not configured')
  return secret
}

export async function createEmailUnsubscribeToken(input: {
  accountId: string
  category: NotificationCategory
  now?: number
}): Promise<string> {
  const category = leafCategorySchema.parse(input.category)
  const iat = input.now ?? Math.floor(Date.now() / 1000)
  return Jwt.sign(
    {
      aud: AUDIENCE,
      accountId: input.accountId,
      category,
      iat,
      exp: iat + TOKEN_TTL_SECONDS,
    } satisfies EmailUnsubscribeClaims,
    unsubscribeSecret(),
    'HS256',
  )
}

export async function getEmailUnsubscribeUrl(input: {
  accountId: string
  category: NotificationCategory
  now?: number
}): Promise<string> {
  const token = await createEmailUnsubscribeToken(input)
  return `${getApiBaseUrl()}/email/unsubscribe?token=${encodeURIComponent(token)}`
}

/** Build controlled headers and a visible text footer for optional email. */
export async function buildEmailUnsubscribeMetadata(input: {
  accountId: string
  category: NotificationCategory
}): Promise<{
  url: string
  headers: { 'List-Unsubscribe': string; 'List-Unsubscribe-Post': string }
  textFooter: string
} | null> {
  try {
    const url = await getEmailUnsubscribeUrl(input)
    const label = input.category.toLowerCase().replaceAll('_', ' ')
    return {
      url,
      headers: {
        'List-Unsubscribe': `<${url}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      textFooter: `\n\nUnsubscribe from ${label} email notifications: ${url}`,
    }
  } catch {
    return null
  }
}

export async function verifyEmailUnsubscribeToken(
  token: string | null | undefined,
): Promise<EmailUnsubscribeClaims | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null
  try {
    const claims = await Jwt.verify(token, unsubscribeSecret(), {
      alg: 'HS256',
      aud: AUDIENCE,
      exp: true,
      iat: true,
    })
    if (
      claims.aud !== AUDIENCE ||
      typeof claims.accountId !== 'string' ||
      !claims.accountId ||
      typeof claims.iat !== 'number' ||
      !Number.isSafeInteger(claims.iat) ||
      typeof claims.exp !== 'number' ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= claims.iat ||
      !leafCategorySchema.safeParse(claims.category).success
    ) {
      return null
    }
    return claims as EmailUnsubscribeClaims
  } catch {
    return null
  }
}
