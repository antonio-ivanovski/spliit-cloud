import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma } from '@spliit/db'

import { loadOfflineSnapshot, offlineTxOptions } from '../../../lib/api/offline'
import { protectedProcedure } from '../../init'
import { OFFLINE_MAX_EXPENSES } from '../../outputs/offline'
import { offlineSnapshotOutputSchema } from '../../outputs/offline'

/**
 * Offline group snapshot: coherent group + overview + global + balances + up to
 * 500 newest expenses (expenseDate desc, createdAt desc, id desc).
 *
 * Membership-only: strictly ACTIVE membership, no link-invite token or view-key
 * path, so this procedure never accepts an invitation as a side effect.
 * Missing/nonmember/inactive -> FORBIDDEN (no existence leak); ACTIVE member
 * whose group row disappeared -> NOT_FOUND.
 *
 * One RepeatableRead transaction (30s timeout) covers auth + rows + calcs;
 * `capturedAt` is the transaction start. The capped response succeeds or fails
 * atomically; clients preserve the existing snapshot on timeout.
 * Private/no-store. Recurrence neighbors come from each series ordered by
 * recurrenceSequence; null sequences are excluded from the chain.
 */
export const offlineSnapshotProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      // Explicitly listed only to reject with FORBIDDEN: offline snapshots are
      // membership-only and must never trigger the side-effectful
      // link-invite accept path used by `groups.get`.
      linkInviteToken: z.string().optional(),
      viewKey: z.string().optional(),
    }),
  )
  .output(offlineSnapshotOutputSchema)
  .query(async ({ input, ctx }) => {
    ctx.resHeaders?.set('Cache-Control', 'private, no-store')
    const accountId = ctx.auth.user.id
    // Strict input validation: only groupId is accepted. A link-invite token
    // or view key here would risk the side-effectful invite-accept path used
    // by `groups.get`; offline snapshots must never trigger it.
    if (input.linkInviteToken) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Link invites are not accepted for offline snapshots',
      })
    }
    if (input.viewKey) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'View keys are not accepted for offline snapshots',
      })
    }
    return prisma.$transaction(async (tx) => {
      const capturedAt = new Date()
      const snapshot = await loadOfflineSnapshot(tx, accountId, input.groupId)
      const hasMore = snapshot.totalCount > snapshot.downloadedCount
      if (snapshot.downloadedCount > OFFLINE_MAX_EXPENSES) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Snapshot exceeds offline cap',
        })
      }
      const output = {
        schemaVersion: 1 as const,
        accountId,
        groupId: input.groupId,
        capturedAt,
        group: snapshot.group,
        overview: snapshot.overview,
        global: snapshot.global,
        balances: snapshot.balances,
        expenses: snapshot.expenses,
        totalCount: snapshot.totalCount,
        downloadedCount: snapshot.downloadedCount,
        hasMore,
        truncatedAt: hasMore ? capturedAt : null,
      }
      const parsed = offlineSnapshotOutputSchema.safeParse(output)
      if (!parsed.success) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Offline snapshot validation failed',
        })
      }
      if (
        parsed.data.accountId !== accountId ||
        parsed.data.groupId !== input.groupId
      ) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Offline snapshot identity mismatch',
        })
      }
      return parsed.data
    }, offlineTxOptions)
  })
