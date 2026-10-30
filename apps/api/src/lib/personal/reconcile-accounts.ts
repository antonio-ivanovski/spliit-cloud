import { prisma } from '@spliit/db'
import { JOB_NAMES, sendJob, type SpliitBoss } from '@spliit/jobs'

import {
  PersonalInclusionService,
  PersonalSyncError,
  runPersonalSyncResult,
} from './inclusion'

export const PERSONAL_RECONCILE_PAGE_SIZE = 50

export type PersonalReconcileResult = {
  scanned: number
  reconciled: number
  nextCursor: string | null
}

/**
 * Daily repair pass for linked personal rows. Enumerates every personal profile
 * (including master-off accounts) and runs the same `reconcile` used by the
 * manual `personal.sources.reconcile` procedure, so master-off accounts still
 * get linked-row cleanup and orphan repair.
 *
 * Failure isolation: a retryable `PersonalSyncError` (DB timeout, deadlock,
 * serialization failure) fails the page so pg-boss retries it. Permanent
 * per-account failures are logged and skipped so one bad account cannot stall
 * the nightly job. Callers continue pages with `{ cursor }`.
 */
export async function reconcilePersonalAccounts(
  boss: SpliitBoss,
  options: { cursor?: string } = {},
): Promise<PersonalReconcileResult> {
  const page = await prisma.personalProfile.findMany({
    ...(options.cursor
      ? { cursor: { accountId: options.cursor }, skip: 1 }
      : {}),
    take: PERSONAL_RECONCILE_PAGE_SIZE,
    orderBy: { accountId: 'asc' },
    select: { accountId: true },
  })

  let reconciled = 0
  for (const row of page) {
    try {
      await runPersonalSyncResult(
        PersonalInclusionService.use((service) =>
          service.reconcile(row.accountId),
        ),
      )
      reconciled += 1
    } catch (error) {
      if (error instanceof PersonalSyncError && error.retryable === false) {
        console.warn(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warning',
            component: 'personal-reconcile',
            message: 'skipped account with permanent sync failure',
            accountId: row.accountId,
            error: error.message,
          }),
        )
        continue
      }
      // Retryable (or unknown) failures abort the page so pg-boss retries
      // the cursor. Already-reconciled accounts in this page are idempotent
      // (compare-before-write + unique constraint), so a retry is safe.
      throw error
    }
  }

  const nextCursor =
    page.length === PERSONAL_RECONCILE_PAGE_SIZE
      ? (page[page.length - 1]?.accountId ?? null)
      : null
  if (nextCursor) {
    try {
      await sendJob(
        boss,
        JOB_NAMES.RECONCILE_PERSONAL,
        { cursor: nextCursor },
        { singletonKey: `personal-reconcile:${nextCursor}` },
      )
    } catch (error) {
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'warning',
          component: 'personal-reconcile',
          message: 'skipped reconcile continuation, enqueue failed',
          cursor: nextCursor,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }
  return { scanned: page.length, reconciled, nextCursor }
}
