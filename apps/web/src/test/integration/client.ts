/**
 * Integration test client.
 *
 * Provides helpers to connect to an existing Spliit API server
 * (expected on http://localhost:3001 by default) for integration tests.
 *
 * Prerequisites:
 * - API server must be running on the expected port.
 * - PostgreSQL test database must be running and migrated.
 */

import type { AppRouter } from '@spliit/api/router'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'

const DEFAULT_API_URL = 'http://localhost:3001'

/**
 * Check if the API is reachable by hitting /health.
 */
export async function probeExistingApi(
  baseUrl = DEFAULT_API_URL,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`)
    return res.ok
  } catch {
    return false
  }
}

/**
 * Create a test tRPC client for data setup. Uses httpBatchLink.
 */
export function createTestTRPCClient(baseUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/trpc`,
        transformer: superjson,
        fetch(url, options) {
          return fetch(url, { ...options, credentials: 'include' })
        },
      }),
    ],
  })
}

/**
 * Sign up or sign in via the existing API's auth endpoints.
 *
 * Because the API requires email verification before a session can be
 * created, this helper marks the account as verified via Prisma after
 * sign-up so that the subsequent sign-in produces a session cookie.
 *
 * Returns the session cookie string.
 */
export async function createTestSession(
  baseUrl = DEFAULT_API_URL,
  email = `test-${Date.now()}@integration.local`,
  password = 'TestPass123!',
): Promise<string> {
  const authHeaders = {
    'Content-Type': 'application/json',
    // better-auth checks trustedOrigins and rejects requests without a
    // matching Origin header. Vitest's fetch (Node.js undici) does not
    // send an Origin header automatically, so we add one explicitly.
    'Origin': 'http://localhost:3000',
  }

  // Try sign-in first; might work if account was already verified
  const signInRes = await fetch(`${baseUrl}/auth/sign-in/email`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ email, password }),
  })
  if (signInRes.ok) {
    return signInRes.headers.get('set-cookie') ?? ''
  }

  // Sign up (ignore if already exists)
  const signUpRes = await fetch(`${baseUrl}/auth/sign-up/email`, {
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
  const retryRes = await fetch(`${baseUrl}/auth/sign-in/email`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ email, password }),
  })
  if (retryRes.ok) {
    return retryRes.headers.get('set-cookie') ?? ''
  }

  throw new Error(
    `Failed to create test session after verification (sign-in ${retryRes.status})`,
  )
}

/**
 * Clean up test account and all its data via Prisma (cascading deletes).
 * Wraps in try/catch in case the database is not available.
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
