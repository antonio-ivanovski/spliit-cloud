import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { groupsRouter } from '../trpc/routers/groups'
import { invitationsRouter } from '../trpc/routers/invitations'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

function getInviteToken(inviteUrl: string) {
  return new URL(inviteUrl).pathname.split('/').at(-1) ?? null
}

describe('Invitation flow — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-admin-${runId}`
  const adminEmail = `admin-${runId}@test.example`
  const inviteeId = `acct-user-${runId}`
  const inviteeEmail = `user-${runId}@test.example`
  const retargetedId = `acct-retarget-${runId}`
  const retargetedEmail = `retarget-${runId}@test.example`

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
    await prisma.account.upsert({
      where: { email: retargetedEmail },
      update: {},
      create: {
        id: retargetedId,
        email: retargetedEmail,
        emailVerified: true,
        name: 'Retargeted User',
      },
    })
  })

  afterAll(async () => {
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
    await prisma.account.delete({ where: { id: inviteeId } }).catch(() => {})
    await prisma.account.delete({ where: { id: retargetedId } }).catch(() => {})
  })

  // ------------------------------------------------------------------
  // 4. Remove member → re-invite → accept
  // ------------------------------------------------------------------
  it('re-invites a removed member by email and restores active status', async () => {
    const groupCaller = adminCaller()

    // Create group
    const { groupId } = await groupCaller.create({
      requestId: crypto.randomUUID(),
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
      requestId: crypto.randomUUID(),
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
      requestId: crypto.randomUUID(),
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
      requestId: crypto.randomUUID(),
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
      requestId: crypto.randomUUID(),
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
      requestId: crypto.randomUUID(),
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

  // ------------------------------------------------------------------
  // 6. Retarget a pending email invitation
  // ------------------------------------------------------------------
  it('retargets a pending invitation: old recipient cannot accept, new recipient can', async () => {
    const groupCaller = adminCaller()

    const { groupId } = await groupCaller.create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: `Retarget Group ${runId}`,
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

    const { invitationId } = await invitationsCaller().create({
      requestId: crypto.randomUUID(),
      groupId,
      email: inviteeEmail,
      role: 'MEMBER',
    })
    const invitationBefore = await prisma.groupInvitation.findUnique({
      where: { id: invitationId },
    })

    // Retarget to a different account (profile name is authoritative).
    const updated = await invitationsCaller().updatePending({
      invitationId,
      role: 'ADMIN',
      temporaryName: 'Submitted Name',
      delivery: { type: 'EMAIL', email: retargetedEmail },
    })
    expect(updated.invitation.email).toBe(retargetedEmail)
    expect(updated.invitation.role).toBe('ADMIN')
    expect(updated.inviteUrl).toBeNull()

    // Identity preserved: same row and ledger participant.
    const invitationAfter = await prisma.groupInvitation.findUnique({
      where: { id: invitationId },
    })
    expect(invitationAfter!.id).toBe(invitationBefore!.id)
    expect(invitationAfter!.ledgerParticipantId).toBe(
      invitationBefore!.ledgerParticipantId,
    )
    // The retargeted account exists, so its profile name wins.
    expect(invitationAfter!.temporaryName).toBe('Retargeted User')

    // The old recipient's email-match acceptance guard rejects.
    await expect(
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).accept({ invitationId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    // The new recipient accepts and gets the pending role.
    const acceptResult = await invitationsCaller({
      accountId: retargetedId,
      email: retargetedEmail,
    }).accept({ invitationId })
    expect(acceptResult.groupId).toBe(groupId)
    const member = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: retargetedId } },
    })
    expect(member!.status).toBe('ACTIVE')
    expect(member!.role).toBe('ADMIN')
    // The old invitee never became a member.
    const oldMember = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(oldMember).toBeNull()
  })

  it('metadata-only saves do not resend or rotate, and keep the credential', async () => {
    const groupCaller = adminCaller()

    const { groupId } = await groupCaller.create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: `Metadata Group ${runId}`,
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

    const created = await invitationsCaller().createLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
      temporaryName: 'Before Edit',
    })
    const before = await prisma.groupInvitation.findUnique({
      where: { id: created.invitationId },
    })

    const updated = await invitationsCaller().updatePending({
      invitationId: created.invitationId,
      role: 'ADMIN',
      temporaryName: 'After Edit',
      delivery: { type: 'LINK' },
    })

    const after = await prisma.groupInvitation.findUnique({
      where: { id: created.invitationId },
    })
    // Existing link credential survives a name/role-only save.
    expect(after!.tokenHash).toBe(before!.tokenHash)
    expect(after!.expiresAt).toEqual(before!.expiresAt)
    expect(after!.temporaryName).toBe('After Edit')
    expect(after!.role).toBe('ADMIN')
    expect(updated.inviteUrl).toBeNull()

    // The old link still works.
    const token = getInviteToken(created.inviteUrl)
    const acceptResult = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token: token! })
    expect(acceptResult.groupId).toBe(groupId)
    const member = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(member!.role).toBe('ADMIN')
  })
})
