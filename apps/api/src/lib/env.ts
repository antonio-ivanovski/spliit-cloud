import { ZodIssueCode, z } from 'zod'

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
    PUBLIC_ENABLE_RECEIPT_EXTRACT: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    PUBLIC_ENABLE_CATEGORY_EXTRACT: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    OPENAI_API_KEY: z.string().optional(),

    // better-auth
    BETTER_AUTH_SECRET: z.string().optional(),
    BETTER_AUTH_URL: z.string().url().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    // Email delivery (magic link + verification)
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        path: ['BETTER_AUTH_SECRET'],
        message: 'BETTER_AUTH_SECRET is required in production',
      })
    }
    if (env.NODE_ENV === 'production' && !env.SMTP_HOST) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required in production',
      })
    }
    if (
      env.PUBLIC_ENABLE_EXPENSE_DOCUMENTS &&
      (!env.S3_UPLOAD_BUCKET ||
        !env.S3_UPLOAD_KEY ||
        !env.S3_UPLOAD_REGION ||
        !env.S3_UPLOAD_SECRET)
    ) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message:
          'If PUBLIC_ENABLE_EXPENSE_DOCUMENTS is specified, then S3_* must be specified too',
      })
    }
    if (
      (env.PUBLIC_ENABLE_RECEIPT_EXTRACT ||
        env.PUBLIC_ENABLE_CATEGORY_EXTRACT) &&
      !env.OPENAI_API_KEY
    ) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message:
          'If PUBLIC_ENABLE_RECEIPT_EXTRACT or PUBLIC_ENABLE_CATEGORY_EXTRACT is specified, then OPENAI_API_KEY must be specified too',
      })
    }
  })

export const env = envSchema.parse(process.env)
export const webOrigins = env.WEB_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
export const hasDatabaseEnv = !!env.DATABASE_URL
