import { prisma } from '@spliit/db'

import { loadOfflineCatalog, offlineTxOptions } from '../../../lib/api/offline'
import { protectedProcedure } from '../../init'
import { offlineCatalogOutputSchema } from '../../outputs/offline'

/**
 * Offline catalog download: all ACTIVE memberships including
 * archived/hidden/FRIEND. Stable group-id ordering on the wire. Overview
 * entries are MEMBER with live-computed financial summaries; no saved views,
 * bearer credentials, or tokens are included.
 *
 * One RepeatableRead transaction (30s timeout) covers auth + rows + calcs;
 * `capturedAt` is the transaction start. Private/no-store so shared caches
 * never retain account data. Large downloads should use a dedicated unbatched
 * tRPC httpLink client; server serialization stays SuperJSON.
 */
export const offlineCatalogProcedure = protectedProcedure
  .output(offlineCatalogOutputSchema)
  .query(async ({ ctx }) => {
    ctx.resHeaders?.set('Cache-Control', 'private, no-store')
    const accountId = ctx.auth.user.id
    return prisma.$transaction(async (tx) => {
      const capturedAt = new Date()
      const groups = await loadOfflineCatalog(tx, accountId)
      const output = {
        schemaVersion: 1 as const,
        accountId,
        capturedAt,
        groups,
      }
      const parsed = offlineCatalogOutputSchema.safeParse(output)
      if (!parsed.success) {
        throw new Error('Offline catalog validation failed')
      }
      if (parsed.data.accountId !== accountId) {
        throw new Error('Offline catalog account mismatch')
      }
      return parsed.data
    }, offlineTxOptions)
  })
