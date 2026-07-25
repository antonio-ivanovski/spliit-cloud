import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.string().optional().default('development'),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://postgres:1234@localhost'),
  JOBS_ENABLED: z.stringbool().optional().default(true),
  /**
   * Run the job worker inside the API process instead of as a separate
   * deployable. Lets a small instance pay for one always-on service instead of
   * two. Ignored when JOBS_ENABLED is false.
   */
  JOBS_INLINE: z.stringbool().optional().default(false),
  PGBOSS_SCHEMA: z.string().min(1).default('pgboss'),
  JOBS_RECONCILIATION_CRON: z.string().min(1).default('* * * * *'),
  JOBS_MAX_CONCURRENCY: z.coerce.number().int().positive().default(5),
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
})

export const env = envSchema.parse(process.env)

export type JobsEnv = typeof env
