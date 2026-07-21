import { prisma } from '@spliit/db'
import type {
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
} from '../lib/notifications/dispatcher'
import { defaultActivityHandlers } from '../lib/notifications/handlers'

/**
 * Verify the test database is reachable.
 * Throws with a clear message if not — the test file will fail at load time.
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

export class CapturingDispatcher implements ActivityNotificationDispatcher {
  events: ActivityNotificationEvent[] = []
  private readonly handlers = defaultActivityHandlers()

  async dispatch(event: ActivityNotificationEvent): Promise<void> {
    const handler = this.handlers.find((h) => h.supports(event.type))
    if (!handler) return
    const intents = await handler.buildIntents(event)
    if (intents.length === 0) return
    this.events.push(event)
  }
}
