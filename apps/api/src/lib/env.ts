import { z } from 'zod'

import { supportedCurrencyCodeSchema } from '@spliit/domain'

const interpretEnvVarAsBool = (val: unknown): boolean => {
  if (typeof val !== 'string') return false
  return ['true', 'yes', '1', 'on'].includes(val.toLowerCase())
}

const emptyStringAsUndefined = (val: unknown) =>
  typeof val === 'string' && val.trim() === '' ? undefined : val

const optionalString = z.preprocess(
  emptyStringAsUndefined,
  z.string().optional(),
)
const optionalUrl = z.preprocess(emptyStringAsUndefined, z.url().optional())

const envSchema = z
  .object({
    NODE_ENV: optionalString,
    PORT: z.coerce.number().int().positive().default(3001),
    WEB_ORIGINS: z.preprocess(
      emptyStringAsUndefined,
      z.string().default('http://localhost:3000'),
    ),
    DATABASE_URL: optionalUrl,
    PUBLIC_ENABLE_EXPENSE_DOCUMENTS: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    PUBLIC_DEFAULT_CURRENCY_CODE: supportedCurrencyCodeSchema.default('USD'),
    S3_UPLOAD_KEY: optionalString,
    S3_UPLOAD_SECRET: optionalString,
    S3_UPLOAD_BUCKET: optionalString,
    S3_UPLOAD_REGION: optionalString,
    S3_UPLOAD_ENDPOINT: optionalString,
    S3_UPLOAD_PUBLIC_URL: optionalUrl,
    PUBLIC_ENABLE_RECEIPT_EXTRACT: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    PUBLIC_ENABLE_VOICE_EXPENSE: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    PUBLIC_ENABLE_CATEGORY_EXTRACT: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    PUBLIC_ENABLE_BULK_CATEGORIZE: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    AI_PROVIDER: z
      .enum(['openai', 'anthropic', 'openai-compatible', 'google'])
      .default('openai'),
    AI_API_KEY: optionalString,
    AI_BASE_URL: optionalUrl,
    AI_RECEIPT_MODEL: z.preprocess(
      emptyStringAsUndefined,
      z.string().default('gpt-5-nano'),
    ),
    AI_CATEGORY_MODEL: z.preprocess(
      emptyStringAsUndefined,
      z.string().default('gpt-5-nano'),
    ),
    AI_VOICE_MODEL: z.preprocess(emptyStringAsUndefined, z.string().optional()),
    AI_CATEGORY_RECENT_EXPENSES_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(50),
    /** Recent title→category pairs for local matching (not sent to the LLM). */
    CATEGORY_MEMORY_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .max(2000)
      .default(200),

    // better-auth
    BETTER_AUTH_SECRET: optionalString,
    BETTER_AUTH_URL: optionalUrl,
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,
    TWITTER_CLIENT_ID: optionalString,
    TWITTER_CLIENT_SECRET: optionalString,
    OIDC_CLIENT_ID: optionalString,
    OIDC_CLIENT_SECRET: optionalString,
    OIDC_DISCOVERY_URL: optionalUrl,
    OIDC_DISPLAY_NAME: optionalString,
    OIDC_PROVIDER_ID: z.preprocess(
      emptyStringAsUndefined,
      z
        .string()
        .regex(
          /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
          'OIDC_PROVIDER_ID must be a URL-safe identifier',
        )
        .optional(),
    ),
    ENABLE_ANONYMOUS_AUTH: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    ENABLE_MCP: z.preprocess(interpretEnvVarAsBool, z.boolean().default(false)),
    MCP_PUBLIC_URL: optionalUrl,
    ASSISTANT_CONFIRMATION_SECRET: optionalString,
    // Set when the API sits behind a trusted reverse proxy (Dokploy, Caddy,
    // a CDN). Only then are X-Forwarded-For / X-Real-IP honored for rate-limit
    // identity; the edge proxy must ensure the right-most forwarded hop is the
    // client address it observed.
    TRUST_PROXY: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),

    // Email delivery (magic link + verification)
    SMTP_HOST: optionalString,
    SMTP_PORT: z.preprocess(
      emptyStringAsUndefined,
      z.coerce.number().int().positive().optional(),
    ),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    EMAIL_FROM: optionalString,

    // Web Push delivery. These are intentionally optional outside production
    // so local development can run without a VAPID key pair.
    PUSH_VAPID_PUBLIC_KEY: optionalString,
    PUSH_VAPID_PRIVATE_KEY: optionalString,
    PUSH_VAPID_SUBJECT: optionalUrl,

    // Dedicated secret for stateless optional-email unsubscribe links.
    EMAIL_UNSUBSCRIBE_SECRET: optionalString,

    // Account registration. `open` is the historical default (anyone can
    // create an account). `invite_only` restricts sign-up to the first
    // account on a fresh instance, emails with a pending group/friend
    // invitation, or visitors carrying a live share-link invite token.
    SIGNUP_MODE: z.enum(['open', 'invite_only']).default('open'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message: 'BETTER_AUTH_SECRET is required in production',
      })
    }
    if (env.ENABLE_ANONYMOUS_AUTH && !env.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message:
          'BETTER_AUTH_SECRET is required when ENABLE_ANONYMOUS_AUTH is true',
      })
    }
    if (env.ENABLE_ANONYMOUS_AUTH && !env.TRUST_PROXY) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message: 'TRUST_PROXY is required when ENABLE_ANONYMOUS_AUTH is true',
      })
    }
    if (env.ENABLE_MCP && !env.MCP_PUBLIC_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['MCP_PUBLIC_URL'],
        message: 'MCP_PUBLIC_URL is required when ENABLE_MCP is true',
      })
    }
    if (
      env.ENABLE_MCP &&
      (!env.ASSISTANT_CONFIRMATION_SECRET ||
        Buffer.byteLength(env.ASSISTANT_CONFIRMATION_SECRET, 'utf8') < 32)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['ASSISTANT_CONFIRMATION_SECRET'],
        message:
          'ASSISTANT_CONFIRMATION_SECRET must be at least 32 bytes when ENABLE_MCP is true',
      })
    }
    if (env.NODE_ENV === 'production' && !env.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required in production',
      })
    }
    if (env.NODE_ENV === 'production' && !env.EMAIL_FROM) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM'],
        message: 'EMAIL_FROM is required in production',
      })
    }
    const pushVapidValues = [
      env.PUSH_VAPID_PUBLIC_KEY,
      env.PUSH_VAPID_PRIVATE_KEY,
      env.PUSH_VAPID_SUBJECT,
    ]
    if (pushVapidValues.some(Boolean) && !pushVapidValues.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUSH_VAPID_PUBLIC_KEY'],
        message:
          'PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY and PUSH_VAPID_SUBJECT must be configured together',
      })
    }
    // Authenticated SMTP requires both values; omitting both intentionally
    // supports trusted self-hosted relays that do not require credentials.
    if (!!env.SMTP_USER !== !!env.SMTP_PASS) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_USER'],
        message: 'SMTP_USER and SMTP_PASS must be configured together',
      })
    }
    if (env.NODE_ENV === 'production' && env.SMTP_HOST) {
      if (
        !env.EMAIL_UNSUBSCRIBE_SECRET ||
        Buffer.byteLength(env.EMAIL_UNSUBSCRIBE_SECRET, 'utf8') < 32
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['EMAIL_UNSUBSCRIBE_SECRET'],
          message:
            'EMAIL_UNSUBSCRIBE_SECRET must be at least 32 bytes in production',
        })
      }
    }
    if (
      env.PUBLIC_ENABLE_EXPENSE_DOCUMENTS &&
      (!env.S3_UPLOAD_BUCKET ||
        !env.S3_UPLOAD_KEY ||
        !env.S3_UPLOAD_REGION ||
        !env.S3_UPLOAD_SECRET)
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'If PUBLIC_ENABLE_EXPENSE_DOCUMENTS is specified, then S3_* must be specified too',
      })
    }
    if (
      (env.PUBLIC_ENABLE_RECEIPT_EXTRACT ||
        env.PUBLIC_ENABLE_CATEGORY_EXTRACT ||
        env.PUBLIC_ENABLE_VOICE_EXPENSE) &&
      !env.AI_API_KEY
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'If PUBLIC_ENABLE_RECEIPT_EXTRACT, PUBLIC_ENABLE_CATEGORY_EXTRACT, or PUBLIC_ENABLE_VOICE_EXPENSE is specified, then AI_API_KEY must be specified too',
      })
    }
    if (env.PUBLIC_ENABLE_VOICE_EXPENSE && !env.AI_VOICE_MODEL) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_VOICE_MODEL'],
        message:
          'AI_VOICE_MODEL must be specified when PUBLIC_ENABLE_VOICE_EXPENSE is enabled',
      })
    }
    const oidcValues = [
      env.OIDC_CLIENT_ID,
      env.OIDC_CLIENT_SECRET,
      env.OIDC_DISCOVERY_URL,
      env.OIDC_DISPLAY_NAME,
      env.OIDC_PROVIDER_ID,
    ]
    if (
      oidcValues.some(Boolean) &&
      (!env.OIDC_CLIENT_ID ||
        !env.OIDC_CLIENT_SECRET ||
        !env.OIDC_DISCOVERY_URL)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['OIDC_CLIENT_ID'],
        message:
          'OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and OIDC_DISCOVERY_URL must be configured together',
      })
    }
  })

export const env = envSchema.parse(process.env)
export const webOrigins = env.WEB_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
export const hasDatabaseEnv = !!env.DATABASE_URL

export const DEFAULT_OIDC_PROVIDER_ID = 'oidc'
export const DEFAULT_OIDC_DISPLAY_NAME = 'SSO'

export type ConfiguredOidcProvider = {
  id: string
  name: string
  clientId: string
  clientSecret: string
  discoveryUrl: string
}

export function getConfiguredOidcProvider(
  source: {
    OIDC_CLIENT_ID?: string
    OIDC_CLIENT_SECRET?: string
    OIDC_DISCOVERY_URL?: string
    OIDC_DISPLAY_NAME?: string
    OIDC_PROVIDER_ID?: string
  } = env,
): ConfiguredOidcProvider | undefined {
  if (
    !source.OIDC_CLIENT_ID ||
    !source.OIDC_CLIENT_SECRET ||
    !source.OIDC_DISCOVERY_URL
  ) {
    return undefined
  }
  return {
    id: source.OIDC_PROVIDER_ID ?? DEFAULT_OIDC_PROVIDER_ID,
    name: source.OIDC_DISPLAY_NAME ?? DEFAULT_OIDC_DISPLAY_NAME,
    clientId: source.OIDC_CLIENT_ID,
    clientSecret: source.OIDC_CLIENT_SECRET,
    discoveryUrl: source.OIDC_DISCOVERY_URL,
  }
}
