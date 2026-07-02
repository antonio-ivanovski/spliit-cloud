import { prisma, GroupMemberStatus, GroupRole } from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { groupsRouter } from '../trpc/routers/groups'
import { invitationsRouter } from '../trpc/routers/invitations'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('Activity list authorization — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-ala-a-${runId}`
  const adminEmail = `ala-a-${runId}@test.example`
  const memberId = `acct-ala-m-${runId}`
  const memberEmail = `ala-m-${runId}@test.example`
  const inviteeId = `acct-ala-i-${runId}`
  const inviteeEmail = `ala-i-${runId}@test.example`
  const revokedId = `acct-ala-v-${runId}`
  const revokedEmail = `ala-v-${runId}@test.example`
  const leftMemberId = `acct-ala-l-${runId}`
  const leftMemberEmail = `ala-l-${runId}@test.example`
  const removedMemberId = `acct-ala-r-${runId}`
  const removedMemberEmail = `ala-r-${runId}@test.example`
  const nonMemberId = `acct-ala-n-${runId}`
  const nonMemberEmail = `ala-n-${runId}@test.example`

  const ledgerIds: string[] = []
  function trackLedger(id: string) {
    ledgerIds.push(id)
  }

  let groupId: string

  function makeCaller(overrides?: { accountId?: string; email?: string }) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: overrides?.accountId ?? adminId,
          email: overrides?.email ?? adminEmail,
          emailVerified: true,
          name: 'Test User',
        },
      },
    } as never)
  }

  beforeAll(async () => {
    const accounts = [
      { id: adminId, email: adminEmail, name: 'Test Admin' },
      { id: memberId, email: memberEmail, name: 'Test Member' },
      { id: inviteeId, email: inviteeEmail, name: 'Test Invitee' },
      { id: revokedId, email: revokedEmail, name: 'Test Revoked' },
      { id: leftMemberId, email: leftMemberEmail, name: 'Test Left' },
      { id: removedMemberId, email: removedMemberEmail, name: 'Test Removed' },
      { id: nonMemberId, email: nonMemberEmail, name: 'Test Non-Member' },
    ]
    for (const acct of accounts) {
      await prisma.account.upsert({
        where: { email: acct.email },
        update: {},
        create: acct,
      })
    }

    const caller = makeCaller()
    const result = await caller.create({
      groupFormValues: {
        name: `Activity Auth Test ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    groupId = result.groupId
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })
    trackLedger(group!.ledger.id)

    const gmMemberId = `gm-ala-m-${runId}`
    const lpMemberId = `lp-ala-m-${runId}`
    await prisma.groupMember.create({
      data: {
        id: gmMemberId,
        groupId,
        accountId: memberId,
        role: GroupRole.MEMBER,
        status: GroupMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
    })
    await prisma.ledgerParticipant.create({
      data: {
        id: lpMemberId,
        ledgerId: group!.ledger.id,
        groupMemberId: gmMemberId,
      },
    })

    const gmLeftId = `gm-ala-l-${runId}`
    const lpLeftId = `lp-ala-l-${runId}`
    await prisma.groupMember.create({
      data: {
        id: gmLeftId,
        groupId,
        accountId: leftMemberId,
        role: GroupRole.MEMBER,
        status: GroupMemberStatus.LEFT,
        leftAt: new Date(),
        joinedAt: new Date(),
      },
    })
    await prisma.ledgerParticipant.create({
      data: {
        id: lpLeftId,
        ledgerId: group!.ledger.id,
        groupMemberId: gmLeftId,
      },
    })

    const gmRemovedId = `gm-ala-r-${runId}`
    const lpRemovedId = `lp-ala-r-${runId}`
    await prisma.groupMember.create({
      data: {
        id: gmRemovedId,
        groupId,
        accountId: removedMemberId,
        role: GroupRole.MEMBER,
        status: GroupMemberStatus.REMOVED,
        leftAt: new Date(),
        joinedAt: new Date(),
      },
    })
    await prisma.ledgerParticipant.create({
      data: {
        id: lpRemovedId,
        ledgerId: group!.ledger.id,
        groupMemberId: gmRemovedId,
      },
    })

    // Create PENDING invitation via the router
    const invCaller = invitationsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: { id: adminId, email: adminEmail, emailVerified: true, name: 'Test Admin' },
      },
    } as never)
    await invCaller.create({ groupId, email: inviteeEmail, role: 'MEMBER' })

    // Create and then revoke an invitation for the revoked invitee
    const { invitationId: revocableId } = await invCaller.create({
      groupId,
      email: revokedEmail,
      role: 'MEMBER',
    })
    await invCaller.revoke({ invitationId: revocableId, settleBalances: false })
  })

  afterAll(async () => {
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    const allIds = [
      adminId, memberId, inviteeId, revokedId,
      leftMemberId, removedMemberId, nonMemberId,
    ]
    for (const id of allIds) {
      await prisma.account.delete({ where: { id } }).catch(() => {})
    }
  })

  // 10.1 — Active member and pending invitee can read
  it('grants an active member access to activity list', async () => {
    const caller = makeCaller({ accountId: memberId, email: memberEmail })
    const result = await caller.activities.list({ groupId })
    expect(result).toHaveProperty('activities')
    expect(result).toHaveProperty('hasMore')
  })

  it('grants a pending email invitee access to activity list', async () => {
    const caller = makeCaller({ accountId: inviteeId, email: inviteeEmail })
    const result = await caller.activities.list({ groupId })
    expect(result).toHaveProperty('activities')
    expect(result).toHaveProperty('hasMore')
  })

  // 10.2 — Left, removed, revoked, non-member get FORBIDDEN
  it('rejects a left member with FORBIDDEN', async () => {
    const caller = makeCaller({ accountId: leftMemberId, email: leftMemberEmail })
    await expect(
      caller.activities.list({ groupId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects a removed member with FORBIDDEN', async () => {
    const caller = makeCaller({ accountId: removedMemberId, email: removedMemberEmail })
    await expect(
      caller.activities.list({ groupId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects a revoked invitee with FORBIDDEN', async () => {
    const caller = makeCaller({ accountId: revokedId, email: revokedEmail })
    await expect(
      caller.activities.list({ groupId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects a non-member with FORBIDDEN', async () => {
    const caller = makeCaller({ accountId: nonMemberId, email: nonMemberEmail })
    await expect(
      caller.activities.list({ groupId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  // 10.4 — Archived group still returns activities
  it('returns activities to an active member when the group is archived', async () => {
    const adminCaller = makeCaller()
    await adminCaller.archive({ groupId, archived: true, force: true })

    const memberCaller = makeCaller({ accountId: memberId, email: memberEmail })
    const result = await memberCaller.activities.list({ groupId })
    expect(result).toHaveProperty('activities')
    expect(result).toHaveProperty('hasMore')

    await adminCaller.archive({ groupId, archived: false })
  })
})
