/**
 * Integration test client.
 *
 * Provides helpers to connect to an existing Spliit API server (expected on
 * http://localhost:3101 by default) for integration tests.
 *
 * Prerequisites: - API server must be running on the expected port. -
 * PostgreSQL test database must be running and migrated.
 */

import { fetch as undiciFetch } from 'undici'

const DEFAULT_API_URL = 'http://localhost:3101'

export const INTEGRATION_API_URL =
  process.env.INTEGRATION_API_URL ?? DEFAULT_API_URL

/**
 * Environment-independent fetch for direct API calls from integration tests.
 *
 * Must be used whenever a request carries the session `Cookie` header: under
 * vitest's happy-dom environment, `fetch` is happy-dom's own implementation,
 * which per the browser Fetch spec treats Cookie as a forbidden request header
 * and strips it — and likewise strips Set-Cookie from responses, so sessions
 * could neither be established nor used.
 */
export const integrationFetch = undiciFetch

/**
 * Extract a `Cookie` header value from a response's Set-Cookie headers.
 *
 * Auth requests must go through undici's fetch (not the ambient one): under
 * vitest's happy-dom environment, `fetch` is happy-dom's own implementation,
 * which strips Set-Cookie from response headers per the browser Fetch spec, so
 * sessions could never be established. Returns clean `name=value` pairs joined
 * for the `Cookie` header (no cookie attributes).
 */
function extractSessionCookie(res: {
  headers: { getSetCookie: () => string[] }
}): string {
  return res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]?.trim() ?? '')
    .filter((pair) => pair.includes('='))
    .join('; ')
}

/** Check if the API is reachable by hitting /health. */
export async function probeExistingApi(
  baseUrl = INTEGRATION_API_URL,
): Promise<boolean> {
  try {
    // undici, not the ambient happy-dom fetch, so probe behavior matches the
    // requests the tests actually make.
    const res = await integrationFetch(`${baseUrl}/health`)
    return res.ok
  } catch {
    return false
  }
}

/**
 * Sign up or sign in via the existing API's auth endpoints.
 *
 * Because the API requires email verification before a session can be created,
 * this helper marks the account as verified via Prisma after sign-up so that
 * the subsequent sign-in produces a session cookie.
 *
 * Returns the session cookie string.
 */
export async function createTestSession(
  baseUrl = INTEGRATION_API_URL,
  email = `test-${Date.now()}@integration.local`,
  password = 'TestPass123!',
): Promise<string> {
  const authHeaders = {
    'Content-Type': 'application/json',
    // better-auth checks trustedOrigins and rejects requests without a
    // matching Origin header. Vitest's fetch (Node.js undici) does not
    // send an Origin header automatically, so we add one explicitly.
    Origin: 'http://localhost:3000',
  }

  // Try sign-in first; might work if account was already verified
  const signInRes = await undiciFetch(`${baseUrl}/auth/sign-in/email`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ email, password }),
  })
  const signInCookie = extractSessionCookie(signInRes)
  if (signInRes.ok && signInCookie) {
    return signInCookie
  }

  // Sign up (ignore if already exists)
  const signUpRes = await undiciFetch(`${baseUrl}/auth/sign-up/email`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ email, password, name: 'Integration Test User' }),
  })
  if (!signUpRes.ok) {
    // Sign-up also failed — surface the sign-in error
    throw new Error(
      `Failed to create test session (sign-up ${signUpRes.status}, sign-in ${signInRes.status})`,
    )
  }

  // Account was created but requires email verification. Mark it verified
  // via Prisma so the follow-up sign-in produces a session cookie.
  try {
    process.env.DATABASE_URL ??= 'postgresql://postgres:1234@localhost'
    const { prisma } = await import('@spliit/db')
    await prisma.account.update({
      where: { email },
      data: { emailVerified: true },
    })
  } catch {
    // DB not available — sign-in will still fail below
  }

  // Sign in now that the email is verified
  const retryRes = await undiciFetch(`${baseUrl}/auth/sign-in/email`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ email, password }),
  })
  const retryCookie = extractSessionCookie(retryRes)
  if (retryRes.ok && retryCookie) {
    return retryCookie
  }

  throw new Error(
    `Failed to create test session after verification (sign-in ${retryRes.status})`,
  )
}

/**
 * Clean up test account and all its data via Prisma (cascading deletes). Wraps
 * in try/catch in case the database is not available.
 */
export async function cleanupTestAccount(email: string): Promise<void> {
  try {
    process.env.DATABASE_URL ??= 'postgresql://postgres:1234@localhost'
    const { prisma } = await import('@spliit/db')
    const account = await prisma.account.findUnique({ where: { email } })
    if (account) {
      await prisma.account.delete({ where: { id: account.id } })
    }
  } catch {
    // Table may not exist or DB not running — skip
  }
}
