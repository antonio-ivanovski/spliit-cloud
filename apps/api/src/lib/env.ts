import { z } from 'zod'

const interpretEnvVarAsBool = (val: unknown): boolean => {
  if (typeof val !== 'string') return false
  return ['true', 'yes', '1', 'on'].includes(val.toLowerCase())
}

const envSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    PORT: z.coerce.number().int().positive().default(3001),
    WEB_ORIGINS: z.string().optional().default('http://localhost:3000'),
    DATABASE_URL: z.string().url().optional(),
    PUBLIC_ENABLE_EXPENSE_DOCUMENTS: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    PUBLIC_DEFAULT_CURRENCY_CODE: z.string().optional(),
    S3_UPLOAD_KEY: z.string().optional(),
    S3_UPLOAD_SECRET: z.string().optional(),
    S3_UPLOAD_BUCKET: z.string().optional(),
    S3_UPLOAD_REGION: z.string().optional(),
    S3_UPLOAD_ENDPOINT: z.string().optional(),
    S3_UPLOAD_PUBLIC_URL: z.string().url().optional(),
    PUBLIC_ENABLE_RECEIPT_EXTRACT: z.preprocess(
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
    AI_API_KEY: z.string().optional(),
    AI_BASE_URL: z.string().url().optional(),
    AI_RECEIPT_MODEL: z.string().optional().default('gpt-5-nano'),
    AI_CATEGORY_MODEL: z.string().optional().default('gpt-5-nano'),
    AI_CATEGORY_RECENT_EXPENSES_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(50),

    // better-auth
    BETTER_AUTH_SECRET: z.string().optional(),
    BETTER_AUTH_URL: z.string().url().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),

    // Email delivery (magic link + verification)
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_FROM: z.string().optional(),

    // Web Push delivery. These are intentionally optional outside production
    // so local development can run without a VAPID key pair.
    PUSH_VAPID_PUBLIC_KEY: z.string().optional(),
    PUSH_VAPID_PRIVATE_KEY: z.string().optional(),
    PUSH_VAPID_SUBJECT: z.url().optional(),

    // Dedicated secret for stateless optional-email unsubscribe links.
    EMAIL_UNSUBSCRIBE_SECRET: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message: 'BETTER_AUTH_SECRET is required in production',
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
    // When SMTP is configured in production, require credentials. This rules
    // out silent misconfiguration against real providers (SendGrid, Mailgun,
    // Postmark, Gmail, ...), which all need a username + password. Local
    // dev-only relays like MailHog are out of scope for production. Anyone
    // who really needs anonymous relay in production can set dummy values.
    if (
      env.NODE_ENV === 'production' &&
      env.SMTP_HOST &&
      (!env.SMTP_USER || !env.SMTP_PASS)
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'SMTP_USER and SMTP_PASS are required in production when SMTP_HOST is set',
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
        env.PUBLIC_ENABLE_CATEGORY_EXTRACT) &&
      !env.AI_API_KEY
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'If PUBLIC_ENABLE_RECEIPT_EXTRACT or PUBLIC_ENABLE_CATEGORY_EXTRACT is specified, then AI_API_KEY must be specified too',
      })
    }
  })

export const env = envSchema.parse(process.env)
export const webOrigins = env.WEB_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
export const hasDatabaseEnv = !!env.DATABASE_URL
