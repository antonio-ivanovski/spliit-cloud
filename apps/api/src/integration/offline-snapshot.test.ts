import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

/**
 * Offline catalog/snapshot integrity + authorization against a real database.
 * Mock-based unit tests cover the wider matrix (FRIEND, recurrence, 500-cap,
 * parity); these tests prove the procedures work end-to-end with real rows.
 * Requires the integration database; fails at load when unreachable.
 */
describe('Offline catalog/snapshot — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-off-${runId}`
  const adminEmail = `off-${runId}@test.example`
  const outsiderId = `acct-off-out-${runId}`
  const outsiderEmail = `off-out-${runId}@test.example`

  const ledgerIds: string[] = []
  function trackLedger(id: string) {
    ledgerIds.push(id)
  }

  function makeCaller(accountId = adminId, email = adminEmail) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: { id: accountId, email, emailVerified: true, name: 'Offline' },
      },
    } as never)
  }

  beforeAll(async () => {
    for (const [id, email] of [
      [adminId, adminEmail],
      [outsiderId, outsiderEmail],
    ] as const) {
      await prisma.user.upsert({
        where: { email },
        update: {},
        create: { id, email, emailVerified: true, name: 'Offline' },
      })
    }
  })

  afterAll(async () => {
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.user.delete({ where: { id: adminId } }).catch(() => {})
    await prisma.user.delete({ where: { id: outsiderId } }).catch(() => {})
  })

  async function createGroupWithExpense(name: string): Promise<{
    groupId: string
    participantId: string
  }> {
    const caller = makeCaller()
    const { groupId } = await caller.create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    const group = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })
    trackLedger(group.ledger.id)
    const participantId = group.members[0]!.ledgerParticipant!.id
    await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: `Dinner ${runId}`,
        amount: 2500,
        paidByList: [{ participant: participantId, shares: 2500 }],
        paidBySplitMode: 'BY_AMOUNT' as const,
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general' as const,
        splitMode: 'EVENLY' as const,
        expenseDate: new Date().toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE' as const,
      },
    })
    return { groupId, participantId }
  }

  it('lists member groups in the offline catalog with MEMBER access', async () => {
    const { groupId } = await createGroupWithExpense(`Offline ${runId}`)
    const catalog = await makeCaller().offlineCatalog()
    const entry = catalog.groups.find((g) => g.overview.id === groupId)
    expect(entry).toBeDefined()
    expect(entry!.overview.access).toBe('MEMBER')
    expect(entry!.overview.viewKey).toBeNull()
    expect(catalog.accountId).toBe(adminId)
    expect(catalog.schemaVersion).toBe(1)
  })

  it('returns a coherent snapshot with matching list/detail ids and no URLs', async () => {
    const { groupId } = await createGroupWithExpense(`Snapshot ${runId}`)
    const snapshot = await makeCaller().offlineSnapshot({ groupId })
    expect(snapshot.schemaVersion).toBe(1)
    expect(snapshot.accountId).toBe(adminId)
    expect(snapshot.groupId).toBe(groupId)
    expect(snapshot.group.viewer.source).toBe('MEMBER')
    expect(snapshot.group.currentMember?.status).toBe('ACTIVE')
    expect(snapshot.expenses.length).toBeGreaterThan(0)
    const listIds = snapshot.expenses.map((e) => e.list.id)
    const detailIds = snapshot.expenses.map((e) => e.detail.id)
    expect(new Set(listIds).size).toBe(listIds.length)
    expect([...listIds].sort()).toEqual([...detailIds].sort())
    for (const record of snapshot.expenses) {
      expect(record.list.documentCount).toBe(record.detail.documents.length)
      for (const doc of record.detail.documents) {
        expect(Object.keys(doc).sort()).toEqual([
          'contentType',
          'fileName',
          'height',
          'id',
          'width',
        ])
      }
    }
    // No tokens or document URLs anywhere in the wire payload.
    expect(JSON.stringify(snapshot)).not.toMatch(/https?:\/\/|token|secret/i)
    expect(snapshot.balances).toBeDefined()
    expect(snapshot.downloadedCount).toBe(snapshot.expenses.length)
    expect(snapshot.hasMore).toBe(
      snapshot.totalCount > snapshot.downloadedCount,
    )
  })

  it('includes archived groups in the offline catalog', async () => {
    const { groupId } = await createGroupWithExpense(`Archived ${runId}`)
    await prisma.group.update({
      where: { id: groupId },
      data: { archived: true },
    })
    const catalog = await makeCaller().offlineCatalog()
    const entry = catalog.groups.find((g) => g.overview.id === groupId)
    expect(entry).toBeDefined()
    expect(entry!.overview.access).toBe('MEMBER')
    const snapshot = await makeCaller().offlineSnapshot({ groupId })
    expect(snapshot.groupId).toBe(groupId)
  })

  it('rejects nonmembers and inactive memberships with FORBIDDEN', async () => {
    const { groupId } = await createGroupWithExpense(`Private ${runId}`)
    const outsider = makeCaller(outsiderId, outsiderEmail)
    await expect(outsider.offlineSnapshot({ groupId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const member = await prisma.groupMember.findFirstOrThrow({
      where: { groupId, accountId: adminId },
    })
    await prisma.groupMember.update({
      where: { id: member.id },
      data: { status: 'LEFT' },
    })
    try {
      await expect(
        makeCaller().offlineSnapshot({ groupId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    } finally {
      await prisma.groupMember.update({
        where: { id: member.id },
        data: { status: 'ACTIVE' },
      })
    }
  })
})
