import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.string().optional().default('development'),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://postgres:1234@localhost'),
  JOBS_ENABLED: z.stringbool().optional().default(true),
  PGBOSS_SCHEMA: z
    .string()
    .transform((value) => value.toLowerCase())
    .pipe(
      z
        .string()
        .regex(
          /^[a-z_][a-z0-9_]*$/,
          'must be a valid PostgreSQL schema identifier',
        ),
    )
    .default('pgboss'),
  JOBS_RECONCILIATION_CRON: z.string().min(1).default('*/30 * * * *'),
  JOBS_NOTIFICATION_RECONCILE_CRON: z.string().min(1).default('*/15 * * * *'),
  JOBS_MAX_CONCURRENCY: z.coerce.number().int().positive().default(1),
  JOBS_POLLING_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  JOBS_MAINTENANCE_POLLING_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
  JOBS_POOL_SIZE: z.coerce.number().int().positive().default(8),
  JOBS_RETRY_LIMIT: z.coerce.number().int().nonnegative().default(5),
  JOBS_RETRY_BACKOFF_SECONDS: z.coerce.number().int().nonnegative().default(30),
  JOBS_RETENTION_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 86_400),
  JOBS_ADMIN_PORT: z.coerce.number().int().positive().default(3003),
  JOBS_ADMIN_HOST: z.string().min(1).default('0.0.0.0'),
  HEALTH_RUNNABLE_LAG_THRESHOLD_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(900_000),
  HEALTH_MISSING_TRANSPORT_THRESHOLD: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(10),
})

export const env = envSchema.parse(process.env)

export type JobsEnv = typeof env
