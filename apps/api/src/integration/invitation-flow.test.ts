import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { groupsRouter } from '../trpc/routers/groups'
import { invitationsRouter } from '../trpc/routers/invitations'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('Invitation flow — real DB', () => {
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

  function invitationsCaller(overrides?: {
    accountId?: string
    email?: string
  }) {
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
      create: {
        id: adminId,
        email: adminEmail,
        emailVerified: true,
        name: 'Test Admin',
      },
    })
    await prisma.account.upsert({
      where: { email: inviteeEmail },
      update: {},
      create: {
        id: inviteeId,
        email: inviteeEmail,
        emailVerified: true,
        name: 'Test User',
      },
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

  // ------------------------------------------------------------------
  // 4. Remove member → re-invite → accept
  // ------------------------------------------------------------------
  it('re-invites a removed member by email and restores active status', async () => {
    const groupCaller = adminCaller()

    // Create group
    const { groupId } = await groupCaller.create({
      groupFormValues: {
        name: `Remove-Reinvite Group ${runId}`,
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

    // Invite the invitee
    const { invitationId } = await invitationsCaller().create({
      groupId,
      email: inviteeEmail,
      role: 'MEMBER',
    })

    // Invitee accepts
    await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).accept({ invitationId })

    // Verify both members exist
    const adminMember = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: adminId } },
    })
    expect(adminMember).not.toBeNull()
    expect(adminMember!.status).toBe('ACTIVE')

    const inviteeMemberBefore = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(inviteeMemberBefore).not.toBeNull()
    expect(inviteeMemberBefore!.status).toBe('ACTIVE')

    // Admin removes the invitee
    await groupCaller.members.remove({
      groupId,
      memberId: inviteeMemberBefore!.id,
    })

    // Verify member is now REMOVED
    const inviteeMemberRemoved = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(inviteeMemberRemoved!.status).toBe('REMOVED')
    expect(inviteeMemberRemoved!.leftAt).not.toBeNull()

    // Admin re-invites the same email — should succeed after the fix
    const reInvite = await invitationsCaller().create({
      groupId,
      email: inviteeEmail,
      role: 'MEMBER',
    })
    expect(reInvite).toHaveProperty('invitationId')

    const newInvitation = await prisma.groupInvitation.findUnique({
      where: { id: reInvite.invitationId },
    })
    expect(newInvitation).not.toBeNull()
    expect(newInvitation!.status).toBe('PENDING')
    // Stale ACCEPTED invitation from the previous membership still exists
    const acceptedInvitations = await prisma.groupInvitation.findMany({
      where: { groupId, email: inviteeEmail.toLowerCase(), status: 'ACCEPTED' },
    })
    expect(acceptedInvitations.length).toBeGreaterThanOrEqual(1)

    // Invitee accepts the new invitation
    const acceptResult = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).accept({ invitationId: reInvite.invitationId })
    expect(acceptResult.groupId).toBe(groupId)

    // Verify member is ACTIVE again with leftAt cleared
    const inviteeMemberRestored = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(inviteeMemberRestored!.status).toBe('ACTIVE')
    expect(inviteeMemberRestored!.leftAt).toBeNull()
    expect(inviteeMemberRestored!.joinedAt).not.toBeNull()
  })

  // ------------------------------------------------------------------
  // 5. Leave → re-invite → accept
  // ------------------------------------------------------------------
  it('re-invites a member who left the group by email and restores active status', async () => {
    const groupCaller = adminCaller()

    // Create group
    const { groupId } = await groupCaller.create({
      groupFormValues: {
        name: `Leave-Reinvite Group ${runId}`,
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

    // Invite the invitee
    const { invitationId } = await invitationsCaller().create({
      groupId,
      email: inviteeEmail,
      role: 'MEMBER',
    })

    // Invitee accepts
    await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).accept({ invitationId })

    // Verify both are active
    const inviteeMemberBefore = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(inviteeMemberBefore!.status).toBe('ACTIVE')

    // Invitee leaves the group (call the leave mutation as the invitee)
    const inviteeGroupCaller = groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: inviteeId,
          email: inviteeEmail,
          emailVerified: true,
          name: 'Test User',
        },
      },
    } as never)
    await inviteeGroupCaller.leave({ groupId })

    // Verify member is now LEFT
    const inviteeMemberLeft = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(inviteeMemberLeft!.status).toBe('LEFT')
    expect(inviteeMemberLeft!.leftAt).not.toBeNull()

    // Admin re-invites the same email — should succeed
    const reInvite = await invitationsCaller().create({
      groupId,
      email: inviteeEmail,
      role: 'MEMBER',
    })
    expect(reInvite).toHaveProperty('invitationId')

    // Invitee accepts the new invitation
    const acceptResult = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).accept({ invitationId: reInvite.invitationId })
    expect(acceptResult.groupId).toBe(groupId)

    // Verify member is ACTIVE again with leftAt cleared
    const inviteeMemberRestored = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(inviteeMemberRestored!.status).toBe('ACTIVE')
    expect(inviteeMemberRestored!.leftAt).toBeNull()
  })
})
