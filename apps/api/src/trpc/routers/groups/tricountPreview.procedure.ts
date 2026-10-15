import { generateKeyPair } from 'node:crypto'
import { promisify } from 'node:util'

import { TRPCError } from '@trpc/server'
import { Effect } from 'effect'
import { z } from 'zod'

import {
  extractTricountToken,
  importErrorToParseResult,
  parseTricountApiResponse,
  type NormalizedSource,
} from '@spliit/domain/import'

import {
  getCachedSource,
  setCachedSource,
} from '../../../lib/import-source-cache'
import { protectedProcedure } from '../../init'
import { importPreviewOutputSchema } from '../../outputs/imports'

const TRICOUNT_API_BASE = 'https://api.tricount.bunq.com'
const TRICOUNT_FETCH_TIMEOUT_MS = 12000
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX_PER_TOKEN = 5

// Reverse-engineered from the Android app (see mlaily/TricountApi):
// device registration mints a session token, then the registry is public
// by share token — no membership required.
const TRICOUNT_USER_AGENT =
  'com.bunq.tricount.android:RELEASE:7.0.7:3174:ANDROID:13:C'
const TRICOUNT_CLIENT_REQUEST_ID = '049bfcdf-6ae4-4cee-af7b-45da31ea85d0'

const fetchTimestamps: Map<string, number[]> = new Map()

function isRateLimited(token: string): boolean {
  const now = Date.now()
  const arr = (fetchTimestamps.get(token) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  )
  if (arr.length >= RATE_LIMIT_MAX_PER_TOKEN) return true
  arr.push(now)
  fetchTimestamps.set(token, arr)
  return false
}

const generateKeyPairAsync = promisify(generateKeyPair)

/**
 * Mint a throwaway installation identity. The bunq device-registration endpoint
 * validates `client_public_key` as a real RSA key (1024-bit keys are rejected
 * with their own error; 2048-bit PKCS#1 PEM succeeds). The private half is
 * never used afterward — the public-link flow authenticates with the bearer
 * session token only — so both halves are discarded after auth. Async keygen so
 * the event loop isn't blocked (~100–300ms of CPU).
 */
function mintInstallationKey(): Effect.Effect<string, Error> {
  return Effect.tryPromise({
    try: async () => {
      const { publicKey } = await generateKeyPairAsync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
        // Private half is never used; keep it out of the keychain-shaped
        // paths by exporting it nowhere.
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      })
      return publicKey as string
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error('RSA keygen failed'),
  })
}

export type TricountPreviewResult =
  | { kind: 'OK'; source: NormalizedSource }
  | { kind: 'NOT_FOUND' }
  | { kind: 'ERROR'; message: string }

function tricountFetchError(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.name === 'AbortError'
      ? 'Tricount timed out'
      : `Tricount request failed: ${cause.message}`
  }
  return 'Failed to fetch Tricount group'
}

function fetchTricountSource(
  token: string,
): Effect.Effect<TricountPreviewResult, never> {
  return Effect.gen(function* () {
    if (isRateLimited(token)) {
      return {
        kind: 'ERROR' as const,
        message: 'Too many requests. Try again in a few seconds.',
      }
    }
    const cached = getCachedSource(`tricount:${token}`)
    if (cached) return { kind: 'OK' as const, source: cached }

    const sourceUrl = `https://tricount.com/${token}`
    const runFetch = Effect.tryPromise({
      try: async () => {
        // Device registration: mint a throwaway identity per import.
        const appId = crypto.randomUUID()
        const clientPublicKey = await Effect.runPromise(mintInstallationKey())
        const authResponse = await fetch(
          `${TRICOUNT_API_BASE}/v1/session-registry-installation`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': TRICOUNT_USER_AGENT,
              'app-id': appId,
              'X-Bunq-Client-Request-Id': TRICOUNT_CLIENT_REQUEST_ID,
            },
            body: JSON.stringify({
              app_installation_uuid: appId,
              client_public_key: clientPublicKey,
              device_description: 'Android',
            }),
            signal: AbortSignal.timeout(TRICOUNT_FETCH_TIMEOUT_MS),
          },
        )
        if (!authResponse.ok) {
          throw new Error(`auth HTTP ${authResponse.status}`)
        }
        const authBody = (await authResponse.json()) as {
          Response: Array<{
            Token?: { token: string }
            UserPerson?: { id: number }
          }>
        }
        const session = authBody.Response.find((item) => item.Token)
        const user = authBody.Response.find((item) => item.UserPerson)
        if (!session?.Token || !user?.UserPerson) {
          throw new Error('auth response missing token')
        }
        const registryResponse = await fetch(
          `${TRICOUNT_API_BASE}/v1/user/${user.UserPerson.id}/registry?public_identifier_token=${token}`,
          {
            headers: {
              'User-Agent': TRICOUNT_USER_AGENT,
              'app-id': appId,
              'X-Bunq-Client-Request-Id': TRICOUNT_CLIENT_REQUEST_ID,
              'X-Bunq-Client-Authentication': session.Token.token,
            },
            signal: AbortSignal.timeout(TRICOUNT_FETCH_TIMEOUT_MS),
          },
        )
        if (registryResponse.status === 404)
          return { status: 'missing' as const }
        if (!registryResponse.ok) {
          throw new Error(`registry HTTP ${registryResponse.status}`)
        }
        return {
          status: 'ok' as const,
          payload: (await registryResponse.json()) as unknown,
        }
      },
      catch: (cause) => tricountFetchError(cause),
    })

    const fetched = yield* runFetch.pipe(
      Effect.catch((message: string) =>
        Effect.succeed({ status: 'failed' as const, message }),
      ),
    )
    if (fetched.status === 'failed') {
      return { kind: 'ERROR' as const, message: fetched.message }
    }
    if (fetched.status === 'missing') return { kind: 'NOT_FOUND' as const }
    const result = yield* Effect.match(
      parseTricountApiResponse(fetched.payload, sourceUrl),
      {
        onFailure: (error) => importErrorToParseResult(error),
        onSuccess: (source) => ({ ok: true as const, source }),
      },
    )
    if (!result.ok) return { kind: 'ERROR' as const, message: result.error }
    setCachedSource(`tricount:${token}`, result.source)
    return { kind: 'OK' as const, source: result.source }
  })
}

export const tricountPreviewProcedure = protectedProcedure
  .input(
    z.object({
      sourceUrl: z.string().min(1),
    }),
  )
  .output(importPreviewOutputSchema)
  .query(async ({ input: { sourceUrl } }) => {
    const token = extractTricountToken(sourceUrl)
    if (!token) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Not a valid Tricount share link or token',
      })
    }
    return Effect.runPromise(fetchTricountSource(token))
  })
