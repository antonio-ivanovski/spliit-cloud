/**
 * "Group not found" hand-off: when a group id does not exist locally,
 * the web client calls this procedure to see whether the source group
 * is reachable on a configured import provider (currently `spliit.app`).
 *
 * A cache hit is the signal that the source group is reachable: the
 * in-memory cache stores the parsed source payload from a recent
 * successful fetch, so we can return `IMPORTABLE` without
 * re-fetching. A cache miss attempts a fresh `spliit.app` fetch and
 * caches the result on success.
 *
 * This is a discovery convenience, not a bypass: the user still
 * walks the import wizard, maps participants, and confirms. The
 * destination group id is always a fresh `randomId()`; the source
 * id is recorded in the activity feed for traceability.
 */

import {
  buildSpliitGroupFetchUrl,
  tryParseSpliitExport,
} from '@spliit/domain/import'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  getCachedSource,
  setCachedSource,
} from '../../../lib/import-source-cache'
import { protectedProcedure } from '../../init'

const SPLIIT_FETCH_TIMEOUT_MS = 8000

async function fetchSpliitSourceQuietly(sourceGroupId: string) {
  const url = buildSpliitGroupFetchUrl(sourceGroupId)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), SPLIIT_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: 'application/json' },
    })
    if (response.status === 404)
      return { ok: false as const, kind: 'NOT_FOUND' }
    if (!response.ok) return { ok: false as const, kind: 'ERROR' }
    const body = await response.json().catch(() => null)
    const parsed = tryParseSpliitExport(body)
    if (!parsed.ok) return { ok: false as const, kind: 'ERROR' }
    setCachedSource(sourceGroupId, parsed.source)
    return { ok: true as const, source: parsed.source }
  } catch {
    return { ok: false as const, kind: 'ERROR' }
  } finally {
    clearTimeout(timer)
  }
}

export const lookupGroupProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
    }),
  )
  .query(async ({ input: { groupId } }) => {
    const cached = getCachedSource(groupId)
    if (cached) {
      return {
        status: 'IMPORTABLE' as const,
        sourceProvider: 'SPLIIT' as const,
        sourceUrl: `https://spliit.app/groups/${groupId}`,
        sourceGroupId: groupId,
        source: cached,
      }
    }
    const fetched = await fetchSpliitSourceQuietly(groupId)
    if (fetched.ok) {
      return {
        status: 'IMPORTABLE' as const,
        sourceProvider: 'SPLIIT' as const,
        sourceUrl: `https://spliit.app/groups/${groupId}`,
        sourceGroupId: groupId,
        source: fetched.source,
      }
    }
    // Local-missing + source-missing. The web client renders the
    // existing not-found page.
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
  })
