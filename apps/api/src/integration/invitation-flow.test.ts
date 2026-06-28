import { prisma } from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { groupsRouter } from '../trpc/routers/groups'
import { invitationsRouter } from '../trpc/routers/invitations'
import { checkDbConnection, isDbReachable, testRunId } from './setup'

await checkDbConnection()
const describeDb = describe.skipIf(!isDbReachable())

describeDb('Invitation flow — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-admin-${runId}`
  const adminEmail = `admin-${runId}@test.example`
  const inviteeId = `acct-user-${runId}`
  const inviteeEmail = `user-${runId}@test.example`

  const ledgerIds: string[] = []
  function trackLedger(id: string) {
    ledgerIds.push(id)
  }

  function adminCaller() {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: adminId,
          email: adminEmail,
          emailVerified: true,
          name: 'Test Admin',
        },
      },
    } as never)
  }

  function invitationsCaller(overrides?: { accountId?: string; email?: string }) {
    return invitationsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: overrides?.accountId ?? adminId,
          email: overrides?.email ?? adminEmail,
          emailVerified: true,
          name: 'Test Admin',
        },
      },
    } as never)
  }

  beforeAll(async () => {
    // Create the admin account and the invitee account
    await prisma.account.upsert({
      where: { email: adminEmail },
      update: {},
      create: { id: adminId, email: adminEmail, emailVerified: true, name: 'Test Admin' },
    })
    await prisma.account.upsert({
      where: { email: inviteeEmail },
      update: {},
      create: { id: inviteeId, email: inviteeEmail, emailVerified: true, name: 'Test User' },
    })
  })

  afterAll(async () => {
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
    await prisma.account.delete({ where: { id: inviteeId } }).catch(() => {})
  })

  // ------------------------------------------------------------------
  // 1. Invite member by email — verify invitation row in DB
  // ------------------------------------------------------------------
  it('creates an email invitation and persists it in the DB', async () => {
    const groupCaller = adminCaller()

    // Create group
    const { groupId } = await groupCaller.create({
      groupFormValues: {
        name: `Invite Group ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { ledgerId: true },
    })
    trackLedger(group!.ledgerId)

    // Invite by email
    const invResult = await invitationsCaller().create({
      groupId,
      email: inviteeEmail,
      role: 'MEMBER',
    })
    expect(invResult).toHaveProperty('invitationId')

    // Verify invitation row in DB
    const invitation = await prisma.groupInvitation.findUnique({
      where: { id: invResult.invitationId },
    })
    expect(invitation).not.toBeNull()
    expect(invitation!.groupId).toBe(groupId)
    expect(invitation!.email).toBe(inviteeEmail.toLowerCase())
    expect(invitation!.role).toBe('MEMBER')
    expect(invitation!.status).toBe('PENDING')
    expect(invitation!.invitedById).toBe(adminId)
  })

  // ------------------------------------------------------------------
  // 2. Accept invitation — verify member added
  // ------------------------------------------------------------------
  it('accepts a pending invitation and adds the user as a group member', async () => {
    const groupCaller = adminCaller()

    // Create group
    const { groupId } = await groupCaller.create({
      groupFormValues: {
        name: `Accept Group ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { ledgerId: true },
    })
    trackLedger(group!.ledgerId)

    // Admin creates invitation
    const { invitationId } = await invitationsCaller().create({
      groupId,
      email: inviteeEmail,
      role: 'MEMBER',
    })

    // Invitee accepts
    const acceptResult = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).accept({ invitationId })
    expect(acceptResult).toHaveProperty('groupId')
    expect(acceptResult.groupId).toBe(groupId)

    // Verify invitation status changed
    const invitation = await prisma.groupInvitation.findUnique({
      where: { id: invitationId },
    })
    expect(invitation!.status).toBe('ACCEPTED')
    expect(invitation!.acceptedById).toBe(inviteeId)
    expect(invitation!.acceptedAt).not.toBeNull()

    // Verify the user is now a group member
    const member = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(member).not.toBeNull()
    expect(member!.status).toBe('ACTIVE')
    expect(member!.role).toBe('MEMBER')
  })

  // ------------------------------------------------------------------
  // 3. Decline invitation — verify status changes
  // ------------------------------------------------------------------
  it('declines a pending invitation and updates status', async () => {
    const groupCaller = adminCaller()

    // Create group
    const { groupId } = await groupCaller.create({
      groupFormValues: {
        name: `Decline Group ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { ledgerId: true },
    })
    trackLedger(group!.ledgerId)

    // Admin creates invitation
    const { invitationId } = await invitationsCaller().create({
      groupId,
      email: inviteeEmail,
      role: 'MEMBER',
    })

    // Invitee declines
    await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).decline({ invitationId })

    // Verify invitation status
    const invitation = await prisma.groupInvitation.findUnique({
      where: { id: invitationId },
    })
    expect(invitation!.status).toBe('DECLINED')

    // Verify the user is NOT a group member
    const member = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(member).toBeNull()
  })
})
