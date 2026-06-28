/**
 * Integration test server.
 *
 * Starts the Spliit API Hono app on a random port so the real
 * TRPCProvider can make authentic HTTP calls through the full API
 * stack — routing, middleware, Zod validation, tRPC procedures,
 * and Prisma queries against a real PostgreSQL test database.
 *
 * Prerequisites:
 * - Test database must be running
 *   (postgresql://test:test@localhost:5432/test, same as API tests).
 * - Migrations must be up to date (run `bun prisma-migrate` first).
 */

import { serve } from '@hono/node-server'
import type { Server } from 'node:http'

let server: Server | null = null

/**
 * Start the API server on a random available port.
 * Resolves once the server is listening.
 */
export async function startTestServer(): Promise<{
  port: number
  close: () => Promise<void>
}> {
  setTestEnv()

  const { app } = await import('@spliit/api/app')

  return new Promise((resolve, reject) => {
    server = serve({ fetch: app.fetch, port: 0 }, (listener: Server) => {
      const addr = listener.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Could not determine server address'))
        return
      }
      resolve({
        port: addr.port,
        close: () => closeTestServer(listener),
      })
    })
  })
}

async function closeTestServer(s: Server) {
  await new Promise<void>((resolve, reject) => {
    s.close((err) => (err ? reject(err) : resolve()))
  })
  server = null
}

/**
 * Create or retrieve a test session. Returns the session cookie.
 */
export async function createTestSession(
  port: number,
  email = 'test@integration-spliit.local',
  password = 'TestPass123!',
): Promise<string> {
  const base = `http://localhost:${port}/auth`

  // Try sign-in first; if it fails, sign up
  const signInRes = await fetch(`${base}/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (signInRes.ok) {
    return signInRes.headers.get('set-cookie') ?? ''
  }

  // Sign up (ignore if already exists)
  const signUpRes = await fetch(`${base}/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'Integration Test User' }),
  })

  if (signUpRes.ok) {
    return signUpRes.headers.get('set-cookie') ?? ''
  }

  // Last attempt — sign-in again (user was just created but need cookie)
  const retryRes = await fetch(`${base}/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (retryRes.ok) {
    return retryRes.headers.get('set-cookie') ?? ''
  }

  throw new Error(
    `Failed to create test session (sign-up ${signUpRes.status}, sign-in ${signInRes.status})`,
  )
}

/**
 * Cleanup: delete all test data for the given email.
 */
export async function cleanupTestData(port: number, email: string) {
  try {
    const { prisma } = await import('@spliit/db')
    const account = await prisma.account.findUnique({ where: { email } })
    if (account) {
      // Delete all related data (GroupMember, Expense, etc.)
      // cascading via FK should handle this
      await prisma.account.delete({ where: { id: account.id } })
    }
  } catch {
    // Table may not exist or DB not running — skip
  }
}

function setTestEnv() {
  // Same defaults as apps/api/src/test/setup-env.ts
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET ??= 'spliit-test-secret'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3001'
  process.env.NODE_ENV ??= 'test'
  process.env.WEB_ORIGINS ??= 'http://localhost:3000'
  process.env.S3_UPLOAD_BUCKET ??= 'spliit-test-bucket'
  process.env.S3_UPLOAD_KEY ??= 'AKIA-TEST'
  process.env.S3_UPLOAD_REGION ??= 'us-east-1'
  process.env.S3_UPLOAD_SECRET ??= 'test-secret'
  process.env.S3_UPLOAD_ENDPOINT ??= ''
  process.env.GOOGLE_CLIENT_ID ??= 'test-google-client-id'
  process.env.GOOGLE_CLIENT_SECRET ??= 'test-google-client-secret'
  process.env.GITHUB_CLIENT_ID ??= 'test-github-client-id'
  process.env.GITHUB_CLIENT_SECRET ??= 'test-github-client-secret'
}
