import {
  buildSpliitGroupFetchUrl,
  extractSpliitGroupIdFromUrl,
  tryParseSpliitExport,
  type NormalizedSource,
} from '@spliit/domain/import'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  getCachedSource,
  setCachedSource,
} from '../../../lib/import-source-cache'
import { protectedProcedure } from '../../init'

const SPLIIT_FETCH_TIMEOUT_MS = 8000
const RATE_LIMIT_WINDOW_MS = 10 * 1000
const RATE_LIMIT_MAX_PER_SOURCE = 5

const fetchTimestamps: Map<string, number[]> = new Map()

function isRateLimited(sourceGroupId: string): boolean {
  const now = Date.now()
  const arr = (fetchTimestamps.get(sourceGroupId) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  )
  if (arr.length >= RATE_LIMIT_MAX_PER_SOURCE) return true
  arr.push(now)
  fetchTimestamps.set(sourceGroupId, arr)
  return false
}

export type PreviewFromUrlResult =
  | { kind: 'OK'; source: NormalizedSource }
  | { kind: 'NOT_FOUND' }
  | { kind: 'ERROR'; message: string }

async function fetchSpliitSource(
  sourceGroupId: string,
): Promise<PreviewFromUrlResult> {
  if (isRateLimited(sourceGroupId)) {
    return {
      kind: 'ERROR',
      message: 'Too many requests. Try again in a few seconds.',
    }
  }
  const cached = getCachedSource(sourceGroupId)
  if (cached) return { kind: 'OK', source: cached }

  const url = buildSpliitGroupFetchUrl(sourceGroupId)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), SPLIIT_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: 'application/json' },
    })
    if (response.status === 404) return { kind: 'NOT_FOUND' }
    if (!response.ok) {
      return {
        kind: 'ERROR',
        message: `Spliit responded with HTTP ${response.status}`,
      }
    }
    const text = await response.text()
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return { kind: 'ERROR', message: 'Spliit response is not JSON' }
    }
    const result = tryParseSpliitExport(body)
    if (!result.ok) return { kind: 'ERROR', message: result.error }
    setCachedSource(sourceGroupId, result.source)
    return { kind: 'OK', source: result.source }
  } catch (err) {
    const message =
      err instanceof Error
        ? `${err.name === 'AbortError' ? 'Spliit timed out' : err.message}`
        : 'Failed to fetch Spliit group'
    return { kind: 'ERROR', message }
  } finally {
    clearTimeout(timer)
  }
}

export const previewFromUrlProcedure = protectedProcedure
  .input(
    z.object({
      sourceUrl: z.string().min(1),
    }),
  )
  .mutation(async ({ input: { sourceUrl } }) => {
    const sourceGroupId = extractSpliitGroupIdFromUrl(sourceUrl)
    if (!sourceGroupId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Not a valid spliit.app group URL',
      })
    }
    const result = await fetchSpliitSource(sourceGroupId)
    return result
  })
