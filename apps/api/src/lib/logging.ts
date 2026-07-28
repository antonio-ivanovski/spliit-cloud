/**
 * Lightweight server-side error logging helpers.
 *
 * We deliberately keep this dependency-free: the existing codebase uses bare
 * `console.*` calls with a `[domain]` prefix. Centralising the formatting here
 * keeps the prefixes consistent and gives us a single place to evolve later
 * (structured logs, sinks, redaction, ...).
 */

/** Format an unknown thrown value as a safe, single-line message. */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

/** Log a hard server failure (unexpected 5xx, uncaught exception). */
export function logServerError(
  context: string,
  err: unknown,
  details?: Record<string, unknown>,
) {
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.error(`[${context}] ${describeError(err)}${payload}`)
}

/** Log a known but user-impacting dependency failure (handled, not unexpected). */
export function logServerWarn(
  context: string,
  err: unknown,
  details?: Record<string, unknown>,
) {
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.warn(`[${context}] ${describeError(err)}${payload}`)
}
