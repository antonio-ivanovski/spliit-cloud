import { z } from 'zod'

/**
 * The only place where queue names and their payload contracts are declared.
 * Consumers can add a handler without losing type safety at enqueue sites.
 */
export const jobPayloadSchemas = {
  'recurring-expense.materialize': z.object({
    seriesId: z.string().min(1),
    sequence: z.number().int().positive(),
    occurrenceDate: z.string().date(),
  }),
  'recurring-expense.reconcile': z.object({
    /** Last series id processed by a bounded reconciliation page. */
    cursor: z.string().min(1).optional(),
  }),
} as const

export type JobName = keyof typeof jobPayloadSchemas
export type JobPayloadMap = {
  [Name in JobName]: z.infer<(typeof jobPayloadSchemas)[Name]>
}
export type JobPayload<Name extends JobName> = JobPayloadMap[Name]

export const JOB_NAMES = {
  MATERIALIZE_RECURRING_EXPENSE: 'recurring-expense.materialize',
  RECONCILE_RECURRING_EXPENSES: 'recurring-expense.reconcile',
} as const satisfies Record<string, JobName>

export const RECURRING_MATERIALIZATION_QUEUE =
  JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE
export const RECURRING_RECONCILIATION_QUEUE =
  JOB_NAMES.RECONCILE_RECURRING_EXPENSES
export const RECURRING_MATERIALIZATION_DLQ = `${RECURRING_MATERIALIZATION_QUEUE}.dead-letter`
export const RECURRING_RECONCILIATION_DLQ = `${RECURRING_RECONCILIATION_QUEUE}.dead-letter`

export const DEAD_LETTER_QUEUE_BY_SOURCE = {
  [RECURRING_MATERIALIZATION_QUEUE]: RECURRING_MATERIALIZATION_DLQ,
  [RECURRING_RECONCILIATION_QUEUE]: RECURRING_RECONCILIATION_DLQ,
} as const satisfies Record<JobName, string>

export function deadLetterQueueFor(sourceQueue: string): string | null {
  return (
    DEAD_LETTER_QUEUE_BY_SOURCE[
      sourceQueue as keyof typeof DEAD_LETTER_QUEUE_BY_SOURCE
    ] ?? null
  )
}

export function sourceQueueForDeadLetter(
  deadLetterQueue: string,
): JobName | null {
  const entry = Object.entries(DEAD_LETTER_QUEUE_BY_SOURCE).find(
    ([, queue]) => queue === deadLetterQueue,
  )
  return (entry?.[0] as JobName | undefined) ?? null
}

export const jobPayloadSchema = <Name extends JobName>(name: Name) =>
  jobPayloadSchemas[name]
