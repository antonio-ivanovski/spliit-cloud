import { prisma } from '@spliit/db'

import type {
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
} from '../lib/notifications/dispatcher'

/**
 * Verify the test database is reachable. Throws with a clear message if not —
 * the test file will fail at load time.
 */
export async function checkDbConnection(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    throw new Error(
      `Database not reachable at ${process.env.DATABASE_URL ?? '(not set)'}. ` +
        `Start the test database and run migrations first.`,
    )
  }
}

/** Unique identifier for a single test-run across parallel workers. */
let runCounter = 0
export function testRunId(): string {
  runCounter++
  return `int-${Date.now()}-${runCounter}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Recurring-expense creation deliberately requires the account bootstrap to
 * have persisted a timezone. Integration callers bypass the browser bootstrap,
 * so recurrence suites must establish that account invariant explicitly.
 */
export async function initializeTestAccountTimeZone(
  accountId: string,
  timeZone = 'UTC',
): Promise<void> {
  await prisma.accountPreference.upsert({
    where: { accountId },
    create: {
      id: `pref-${accountId}`,
      accountId,
      timeZone,
    },
    update: { timeZone },
  })
}

export class CapturingDispatcher implements ActivityNotificationDispatcher {
  events: ActivityNotificationEvent[] = []

  async dispatch(event: ActivityNotificationEvent): Promise<void> {
    this.events.push(event)
  }
}
