import { prisma } from '@spliit/db'

export type ShutdownDependencies = {
  stopServer?: () => void
  stopBoss?: () => Promise<void>
  disconnectPrisma?: () => Promise<void>
}

export type ShutdownResult = {
  clean: boolean
  /**
   * `true` when this invocation actually ran the cleanup. The first
   * caller observes the real outcome; subsequent callers see
   * `{ clean, ran: false }` so they can still await the same promise
   * without re-running side effects.
   */
  ran: boolean
}

let inFlight: Promise<ShutdownResult> | null = null

function noop() {}

/**
 * Run every resource cleanup step exactly once, even when the signal
 * arrives twice (SIGINT + SIGTERM, or a test that races two callers).
 * Each step has its own try/catch so a server-stop failure does not
 * leak the Prisma connection or pg-boss worker.
 *
 * The first caller is marked `ran: true` so signal handlers can use
 * it to decide whether to escalate to a non-zero exit. Subsequent
 * callers receive `ran: false` and share the same in-flight promise.
 */
export function runShutdown(
  deps: ShutdownDependencies = {},
): Promise<ShutdownResult> {
  if (inFlight) return inFlight.then((result) => ({ ...result, ran: false }))
  const stopServer = deps.stopServer ?? noop
  const stopBoss = deps.stopBoss ?? (async () => undefined)
  const defaultDisconnectPrisma = () => prisma.$disconnect()
  const disconnectPrisma = deps.disconnectPrisma ?? defaultDisconnectPrisma

  inFlight = (async () => {
    let clean = true
    try {
      stopServer()
    } catch (error) {
      console.error('Failed to stop server', error)
      clean = false
    }
    try {
      await stopBoss()
    } catch (error) {
      console.error('Failed to stop API job client', error)
      clean = false
    }
    try {
      await disconnectPrisma()
    } catch (error) {
      console.error('Failed to disconnect Prisma', error)
      clean = false
    }
    return { clean, ran: true }
  })()
  return inFlight
}

export function isShutdownInFlight(): boolean {
  return inFlight !== null
}

/** Test helper: clear the once-guard so a single test can drive a full cycle. */
export function resetShutdownForTests(): void {
  inFlight = null
}
