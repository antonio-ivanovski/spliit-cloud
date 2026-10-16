/**
 * Unified import-preview service: rate-limit + cache + fetch + parse behind one
 * `Context.Service` boundary.
 *
 * Both `importPreview` (spliit.app JSON) and `tricountPreview` (unofficial
 * Tricount registry API) share the same shape: extract id → rate-limit → cache
 * → fetch → normalize → cache. Provider fetch/parse details stay per-provider
 * functions; this module owns the shared plumbing so future URL-based providers
 * plug in without duplicating it.
 */

import { generateKeyPair } from 'node:crypto'
import { promisify } from 'node:util'

import { Context, Effect, Layer } from 'effect'

import {
  buildSpliitGroupFetchUrl,
  extractSpliitGroupIdFromUrl,
  extractTricountToken,
  runParseSpliitJson,
  runParseTricountApi,
  type NormalizedSource,
} from '@spliit/domain/import'

import { getCachedSource, setCachedSource } from './import-source-cache'

export type PreviewResult =
  | { kind: 'OK'; source: NormalizedSource }
  | { kind: 'NOT_FOUND' }
  | { kind: 'ERROR'; message: string }

export type PreviewFetchImpl = (
  url: string,
  init: RequestInit,
) => Promise<Response>

export class ImportPreviewService extends Context.Service<
  ImportPreviewService,
  {
    readonly previewSpliitUrl: (
      sourceUrl: string,
    ) => Effect.Effect<PreviewResult, never>
    readonly previewTricountUrl: (
      sourceUrl: string,
    ) => Effect.Effect<PreviewResult, never>
  }
>()('ImportPreviewService') {}

const SPLIIT_FETCH_TIMEOUT_MS = 8000
const TRICOUNT_FETCH_TIMEOUT_MS = 12000
const SPLIIT_RATE_LIMIT_WINDOW_MS = 10 * 1000
const SPLIIT_RATE_LIMIT_MAX_PER_SOURCE = 5
const TRICOUNT_RATE_LIMIT_WINDOW_MS = 60 * 1000
const TRICOUNT_RATE_LIMIT_MAX_PER_TOKEN = 5

// Reverse-engineered from the Android app (see mlaily/TricountApi):
// device registration mints a session token, then the registry is public
// by share token — no membership required.
const TRICOUNT_API_BASE = 'https://api.tricount.bunq.com'
const TRICOUNT_USER_AGENT =
  'com.bunq.tricount.android:RELEASE:7.0.7:3174:ANDROID:13:C'
const TRICOUNT_CLIENT_REQUEST_ID = '049bfcdf-6ae4-4cee-af7b-45da31ea85d0'

const generateKeyPairAsync = promisify(generateKeyPair)

function makeRateLimiter(windowMs: number, maxPerKey: number) {
  const timestamps = new Map<string, number[]>()
  return (key: string): boolean => {
    const now = Date.now()
    const arr = (timestamps.get(key) ?? []).filter((t) => now - t < windowMs)
    if (arr.length >= maxPerKey) return true
    arr.push(now)
    timestamps.set(key, arr)
    return false
  }
}

function mintInstallationKey(): Effect.Effect<string, Error> {
  return Effect.tryPromise({
    try: async () => {
      const { publicKey } = await generateKeyPairAsync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      })
      return publicKey as string
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error('RSA keygen failed'),
  })
}

function tricountFetchError(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.name === 'AbortError'
      ? 'Tricount timed out'
      : `Tricount request failed: ${cause.message}`
  }
  return 'Failed to fetch Tricount group'
}

function makeService(fetchImpl: PreviewFetchImpl) {
  const isSpliitRateLimited = makeRateLimiter(
    SPLIIT_RATE_LIMIT_WINDOW_MS,
    SPLIIT_RATE_LIMIT_MAX_PER_SOURCE,
  )
  const isTricountRateLimited = makeRateLimiter(
    TRICOUNT_RATE_LIMIT_WINDOW_MS,
    TRICOUNT_RATE_LIMIT_MAX_PER_TOKEN,
  )

  const previewSpliitUrl = (
    sourceUrl: string,
  ): Effect.Effect<PreviewResult, never> =>
    Effect.gen(function* () {
      const sourceGroupId = extractSpliitGroupIdFromUrl(sourceUrl)
      if (!sourceGroupId) {
        return {
          kind: 'ERROR' as const,
          message: 'Not a valid spliit.app group URL',
        }
      }
      if (isSpliitRateLimited(sourceGroupId)) {
        return {
          kind: 'ERROR' as const,
          message: 'Too many requests. Try again in a few seconds.',
        }
      }
      const cached = getCachedSource(sourceGroupId)
      if (cached) return { kind: 'OK' as const, source: cached }

      const url = buildSpliitGroupFetchUrl(sourceGroupId)
      const fetched = yield* Effect.tryPromise({
        try: async () => {
          const ac = new AbortController()
          const timer = setTimeout(() => ac.abort(), SPLIIT_FETCH_TIMEOUT_MS)
          try {
            const response = await fetchImpl(url, {
              signal: ac.signal,
              headers: { Accept: 'application/json' },
            })
            if (response.status === 404) return { status: 'missing' as const }
            if (!response.ok) {
              return {
                status: 'failed' as const,
                message: `Spliit responded with HTTP ${response.status}`,
              }
            }
            const text = await response.text()
            let body: unknown
            try {
              body = JSON.parse(text)
            } catch {
              return {
                status: 'failed' as const,
                message: 'Spliit response is not JSON',
              }
            }
            return { status: 'ok' as const, body }
          } finally {
            clearTimeout(timer)
          }
        },
        catch: (cause) =>
          cause instanceof Error
            ? `${cause.name === 'AbortError' ? 'Spliit timed out' : cause.message}`
            : 'Failed to fetch Spliit group',
      }).pipe(
        Effect.catch((message: string) =>
          Effect.succeed({ status: 'failed' as const, message }),
        ),
      )
      if (fetched.status === 'failed') {
        return { kind: 'ERROR' as const, message: fetched.message }
      }
      if (fetched.status === 'missing') return { kind: 'NOT_FOUND' as const }
      const result = runParseSpliitJson(fetched.body)
      if (!result.ok) return { kind: 'ERROR' as const, message: result.error }
      setCachedSource(sourceGroupId, result.source)
      return { kind: 'OK' as const, source: result.source }
    })

  const previewTricountUrl = (
    sourceUrl: string,
  ): Effect.Effect<PreviewResult, never> =>
    Effect.gen(function* () {
      const token = extractTricountToken(sourceUrl)
      if (!token) {
        return {
          kind: 'ERROR' as const,
          message: 'Not a valid Tricount share link or token',
        }
      }
      if (isTricountRateLimited(token)) {
        return {
          kind: 'ERROR' as const,
          message: 'Too many requests. Try again in a few seconds.',
        }
      }
      const cached = getCachedSource(`tricount:${token}`)
      if (cached) return { kind: 'OK' as const, source: cached }

      const fetchSourceUrl = `https://tricount.com/${token}`
      const fetched = yield* Effect.tryPromise({
        try: async () => {
          const appId = crypto.randomUUID()
          const clientPublicKey = await Effect.runPromise(mintInstallationKey())
          const authResponse = await fetchImpl(
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
          const registryResponse = await fetchImpl(
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
      }).pipe(
        Effect.catch((message: string) =>
          Effect.succeed({ status: 'failed' as const, message }),
        ),
      )
      if (fetched.status === 'failed') {
        return { kind: 'ERROR' as const, message: fetched.message }
      }
      if (fetched.status === 'missing') return { kind: 'NOT_FOUND' as const }
      const result = runParseTricountApi(fetched.payload, fetchSourceUrl)
      if (!result.ok) return { kind: 'ERROR' as const, message: result.error }
      setCachedSource(`tricount:${token}`, result.source)
      return { kind: 'OK' as const, source: result.source }
    })

  return ImportPreviewService.of({ previewSpliitUrl, previewTricountUrl })
}

/** Live layer: real fetch behind the service boundary. */
export function makeImportPreviewLayer(
  fetchImpl: PreviewFetchImpl = (url, init) => fetch(url, init),
) {
  return Layer.succeed(ImportPreviewService, makeService(fetchImpl))
}

export const ImportPreviewLive = makeImportPreviewLayer()
