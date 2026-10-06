/**
 * Shared cleartext guard for the System One decision-model endpoint.
 *
 * Both the expense title/group context and the `Authorization: Bearer` key
 * travel to `AI_SYSTEM_ONE_BASE_URL`, so a non-loopback `http:` URL would leak
 * credentials and expense data in cleartext. Plaintext HTTP is only accepted
 * for local loopback development (e.g. a self-hosted Kev on `http://localhost`
 * or `http://127.0.0.1`).
 *
 * Kept free of other imports so both `lib/env.ts` (boot validation) and
 * `lib/ai/system-one-categorize.ts` (runtime guard) can share one predicate
 * without creating an import cycle.
 */

/** True for hostnames that refer to the local machine. */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1') return true
  return host.startsWith('127.')
}

/**
 * Throw when `value` would send System One credentials and expense context over
 * non-loopback plaintext HTTP. Unparsable values are left to the `z.url()`
 * schema / `fetch` to report.
 */
export function assertSystemOneBaseUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return
  }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new Error(
      'AI_SYSTEM_ONE_BASE_URL must use HTTPS (HTTP is only allowed for local loopback development, e.g. http://localhost or http://127.0.0.1)',
    )
  }
}
