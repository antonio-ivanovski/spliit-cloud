import { describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import {
  getGrantGeneration,
  getRefreshFamilyGeneration,
  incrementGrantGeneration,
  oauthGrantGenerationRowId,
  oauthRefreshFamilyIdentifier,
  recordRefreshFamilyGeneration,
} from '../lib/auth/oauth-grant-generation'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('OAuth grant generation counter', () => {
  const runId = testRunId()

  async function cleanupPair(accountId: string, clientId: string) {
    // Only the pair's own deterministic row: other tests' counters share the
    // same database and must never be touched.
    await prisma.verification
      .deleteMany({
        where: { id: oauthGrantGenerationRowId(accountId, clientId) },
      })
      .catch(() => {})
  }

  it('increments exactly once per concurrent first disconnect', async () => {
    const accountId = `gen-acct-${runId}-first`
    const clientId = `gen-client-${runId}-first`
    await cleanupPair(accountId, clientId)

    const parallel = 8
    const results = await Promise.all(
      Array.from({ length: parallel }, () =>
        incrementGrantGeneration(accountId, clientId),
      ),
    )

    // No increment is lost: concurrent disconnects serialize onto distinct
    // generations instead of both observing absence and writing 1.
    expect([...results].sort((a, b) => a - b)).toEqual(
      Array.from({ length: parallel }, (_, index) => index + 1),
    )
    await expect(getGrantGeneration(accountId, clientId)).resolves.toBe(
      parallel,
    )
    await cleanupPair(accountId, clientId)
  })

  it('increments exactly once per concurrent disconnect on an existing row', async () => {
    const accountId = `gen-acct-${runId}-existing`
    const clientId = `gen-client-${runId}-existing`
    await cleanupPair(accountId, clientId)
    await incrementGrantGeneration(accountId, clientId)

    const parallel = 5
    const results = await Promise.all(
      Array.from({ length: parallel }, () =>
        incrementGrantGeneration(accountId, clientId),
      ),
    )

    expect([...results].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6])
    await expect(getGrantGeneration(accountId, clientId)).resolves.toBe(6)
    await cleanupPair(accountId, clientId)
  })

  it('keeps refresh family bindings readable past 90 days', async () => {
    const codeId = `family-code-${runId}`
    await recordRefreshFamilyGeneration(codeId, 3)
    try {
      // Age the row past the old 90-day expiry: rotation keeps families
      // alive indefinitely, so age must never orphan a live family.
      const aged = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
      await prisma.verification.updateMany({
        where: { identifier: oauthRefreshFamilyIdentifier(codeId) },
        data: { createdAt: aged },
      })

      await expect(getRefreshFamilyGeneration(codeId)).resolves.toBe(3)
    } finally {
      await prisma.verification
        .deleteMany({
          where: { identifier: oauthRefreshFamilyIdentifier(codeId) },
        })
        .catch(() => {})
    }
  })
})
