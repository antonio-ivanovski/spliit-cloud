import { describe, expect, it, vi } from 'vitest'

import { sendJob, type SpliitBoss } from './boss'
import {
  DEAD_LETTER_QUEUE_BY_SOURCE,
  deadLetterQueueFor,
  JOB_NAMES,
  jobPayloadSchema,
  NOTIFICATION_CLEANUP_DLQ,
  NOTIFICATION_CLEANUP_QUEUE,
  NOTIFICATION_DELIVER_DLQ,
  NOTIFICATION_DELIVER_QUEUE,
  NOTIFICATION_RECONCILE_DLQ,
  NOTIFICATION_RECONCILE_QUEUE,
  RECURRING_MATERIALIZATION_DLQ,
  RECURRING_MATERIALIZATION_QUEUE,
  RECURRING_RECONCILIATION_DLQ,
  RECURRING_RECONCILIATION_QUEUE,
  sourceQueueForDeadLetter,
} from './registry'

function createBossMock() {
  return {
    send: vi.fn(async () => 'job-id'),
  } as unknown as SpliitBoss
}

describe('notification job registry', () => {
  it('accepts legacy v1 materialization payloads without a schedule version', () => {
    expect(
      jobPayloadSchema('recurring-expense.materialize').parse({
        seriesId: 'series-1',
        sequence: 2,
        occurrenceDate: '2026-07-22',
      }),
    ).toEqual({
      seriesId: 'series-1',
      sequence: 2,
      occurrenceDate: '2026-07-22',
    })
  })

  it('declares every job name with a payload schema', () => {
    expect(JOB_NAMES.NOTIFICATION_DELIVER).toBe('notification.deliver')
    expect(JOB_NAMES.NOTIFICATION_RECONCILE).toBe('notification.reconcile')
    expect(JOB_NAMES.NOTIFICATION_CLEANUP).toBe('notification.cleanup')

    expect(jobPayloadSchema('notification.deliver').shape).toBeDefined()
    expect(jobPayloadSchema('notification.reconcile').shape).toBeDefined()
    expect(jobPayloadSchema('notification.cleanup').shape).toBeDefined()
  })

  it('exposes dedicated dead-letter queue constants for every notification source', () => {
    expect(NOTIFICATION_DELIVER_DLQ).toBe('notification.deliver.dead-letter')
    expect(NOTIFICATION_RECONCILE_DLQ).toBe(
      'notification.reconcile.dead-letter',
    )
    expect(NOTIFICATION_CLEANUP_DLQ).toBe('notification.cleanup.dead-letter')
  })

  it('maps every source queue to its dead-letter queue', () => {
    expect(DEAD_LETTER_QUEUE_BY_SOURCE[NOTIFICATION_DELIVER_QUEUE]).toBe(
      NOTIFICATION_DELIVER_DLQ,
    )
    expect(DEAD_LETTER_QUEUE_BY_SOURCE[NOTIFICATION_RECONCILE_QUEUE]).toBe(
      NOTIFICATION_RECONCILE_DLQ,
    )
    expect(DEAD_LETTER_QUEUE_BY_SOURCE[NOTIFICATION_CLEANUP_QUEUE]).toBe(
      NOTIFICATION_CLEANUP_DLQ,
    )
    expect(DEAD_LETTER_QUEUE_BY_SOURCE[RECURRING_MATERIALIZATION_QUEUE]).toBe(
      RECURRING_MATERIALIZATION_DLQ,
    )
    expect(DEAD_LETTER_QUEUE_BY_SOURCE[RECURRING_RECONCILIATION_QUEUE]).toBe(
      RECURRING_RECONCILIATION_DLQ,
    )
  })

  it('looks up dead-letter and source queues in both directions', () => {
    expect(deadLetterQueueFor(NOTIFICATION_DELIVER_QUEUE)).toBe(
      NOTIFICATION_DELIVER_DLQ,
    )
    expect(deadLetterQueueFor(NOTIFICATION_RECONCILE_QUEUE)).toBe(
      NOTIFICATION_RECONCILE_DLQ,
    )
    expect(deadLetterQueueFor(NOTIFICATION_CLEANUP_QUEUE)).toBe(
      NOTIFICATION_CLEANUP_DLQ,
    )
    expect(deadLetterQueueFor('unknown.queue')).toBeNull()

    expect(sourceQueueForDeadLetter(NOTIFICATION_DELIVER_DLQ)).toBe(
      NOTIFICATION_DELIVER_QUEUE,
    )
    expect(sourceQueueForDeadLetter(NOTIFICATION_RECONCILE_DLQ)).toBe(
      NOTIFICATION_RECONCILE_QUEUE,
    )
    expect(sourceQueueForDeadLetter(NOTIFICATION_CLEANUP_DLQ)).toBe(
      NOTIFICATION_CLEANUP_QUEUE,
    )
    expect(sourceQueueForDeadLetter('unknown.dead-letter')).toBeNull()
  })

  it('rejects a missing or empty notification deliveryId', async () => {
    const boss = createBossMock()

    await expect(
      sendJob(boss, JOB_NAMES.NOTIFICATION_DELIVER, { deliveryId: '' }),
    ).rejects.toThrow()

    await expect(
      sendJob(
        boss,
        JOB_NAMES.NOTIFICATION_DELIVER,
        // @ts-expect-error missing fields should be rejected by the schema
        {},
      ),
    ).rejects.toThrow()
  })

  it('accepts a well-formed notification deliveryId', async () => {
    const boss = createBossMock()

    await expect(
      sendJob(boss, JOB_NAMES.NOTIFICATION_DELIVER, {
        deliveryId: 'delivery-123',
      }),
    ).resolves.toBeDefined()
  })
})
