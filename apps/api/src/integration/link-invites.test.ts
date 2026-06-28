import { prisma } from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashLinkToken } from '../lib/invitations'
import { groupsRouter } from '../trpc/routers/groups'
import { invitationsRouter } from '../trpc/routers/invitations'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('Link invitation flow — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-admin-link-${runId}`
  const adminEmail = `admin-link-${runId}@test.example`
  const inviteeId = `acct-invitee-link-${runId}`
  const inviteeEmail = `invitee-link-${runId}@test.example`

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
          name:
            overrides?.accountId === inviteeId ? 'Test Invitee' : 'Test Admin',
        },
      },
    } as never)
  }

  beforeAll(async () => {
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
        name: 'Test Invitee',
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
  // Helper: create a group and return its ledgerId
  // ------------------------------------------------------------------
  async function createTestGroup(
    name: string,
  ): Promise<{ groupId: string; ledgerId: string }> {
    const caller = adminCaller()
    const { groupId } = await caller.create({
      groupFormValues: {
        name,
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
    return { groupId, ledgerId: group!.ledgerId }
  }

  // ------------------------------------------------------------------
  // 1. Create and accept a link invitation
  // ------------------------------------------------------------------
  it('creates a link invitation, returns a shareable URL, and the invitee can accept it', async () => {
    const { groupId } = await createTestGroup(`Link Invite ${runId}`)

    // Admin creates a link invitation
    const createResult = await invitationsCaller().createLink({
      groupId,
      role: 'MEMBER',
      temporaryName: 'Guest User',
    })
    expect(createResult).toHaveProperty('invitationId')
    expect(createResult).toHaveProperty('inviteUrl')
    expect(createResult.inviteUrl).toMatch(
      /^http:\/\/localhost:3000\/groups\/.+\?invite=[A-Za-z0-9_-]+$/,
    )

    // Verify invitation was created in DB with type LINK
    const invitation = await prisma.groupInvitation.findUnique({
      where: { id: createResult.invitationId },
    })
    expect(invitation).not.toBeNull()
    expect(invitation!.type).toBe('LINK')
    expect(invitation!.groupId).toBe(groupId)
    expect(invitation!.role).toBe('MEMBER')
    expect(invitation!.status).toBe('PENDING')
    expect(invitation!.invitedById).toBe(adminId)
    expect(invitation!.temporaryName).toBe('Guest User')
    expect(invitation!.tokenHash).not.toBeNull()
    expect(invitation!.expiresAt).not.toBeNull()
    // The placeholder email should use the reserved domain
    expect(invitation!.email.endsWith('@link.placeholder.local')).toBe(true)

    // Extract the raw token from the invite URL
    const inviteUrl = new URL(createResult.inviteUrl)
    const token = inviteUrl.searchParams.get('invite')
    expect(token).not.toBeNull()
    expect(token!.length).toBeGreaterThanOrEqual(16)

    // Invitee accepts via their own auth context
    const acceptResult = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token: token! })
    expect(acceptResult).toHaveProperty('groupId')
    expect(acceptResult.groupId).toBe(groupId)
    expect(acceptResult.role).toBe('MEMBER')

    // Verify invitation status changed
    const updatedInvitation = await prisma.groupInvitation.findUnique({
      where: { id: createResult.invitationId },
    })
    expect(updatedInvitation!.status).toBe('ACCEPTED')
    expect(updatedInvitation!.acceptedById).toBe(inviteeId)
    expect(updatedInvitation!.acceptedAt).not.toBeNull()

    // Verify the invitee is now a group member
    const member = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(member).not.toBeNull()
    expect(member!.status).toBe('ACTIVE')
    expect(member!.role).toBe('MEMBER')
  })

  // ------------------------------------------------------------------
  // 2. Accept link invite as a signed-in user (second account)
  // ------------------------------------------------------------------
  it('allows a second signed-in user to accept a link invitation', async () => {
    const { groupId } = await createTestGroup(`Link SignedIn ${runId}`)

    // Admin creates a link invitation (no temporary name)
    const createResult = await invitationsCaller().createLink({
      groupId,
      role: 'MEMBER',
    })
    expect(createResult).toHaveProperty('invitationId')
    expect(createResult).toHaveProperty('inviteUrl')

    const inviteUrl = new URL(createResult.inviteUrl)
    const token = inviteUrl.searchParams.get('invite')
    expect(token).not.toBeNull()

    // Accept as the invitee (signed-in user)
    const acceptResult = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token: token! })
    expect(acceptResult.groupId).toBe(groupId)

    // Verify the invitee is now a member
    const member = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(member).not.toBeNull()
    expect(member!.status).toBe('ACTIVE')
  })

  // ------------------------------------------------------------------
  // 3. Expired link invite
  // ------------------------------------------------------------------
  it('rejects acceptance of an expired link invitation', async () => {
    const { groupId } = await createTestGroup(`Link Expired ${runId}`)

    // Create a link invitation with an expiry date in the past.
    // The router does not expose expiresAt, so we generate a token,
    // hash it, and create the invitation row directly via Prisma.
    const rawToken = 'test-expired-token-' + runId
    // Use a longer token that passes the schema validation (>=16 chars)
    const token = rawToken.padEnd(16, 'x')
    const tokenHash = await hashLinkToken(token)

    await prisma.groupInvitation.create({
      data: {
        id: `inv-expired-${runId}`,
        type: 'LINK',
        groupId,
        email: `${token}@link.placeholder.local`,
        role: 'MEMBER',
        invitedById: adminId,
        tokenHash,
        expiresAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
      },
    })

    // Attempt to accept the expired link
    await expect(
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).acceptLink({ token }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/expired/i),
    })

    // Verify the invitation status is still PENDING
    const invitation = await prisma.groupInvitation.findFirst({
      where: { tokenHash },
    })
    expect(invitation).not.toBeNull()
    expect(invitation!.status).toBe('PENDING')
  })

  // ------------------------------------------------------------------
  // 4. Accepting a revoked link
  // ------------------------------------------------------------------
  it('rejects acceptance of a revoked link invitation', async () => {
    const { groupId } = await createTestGroup(`Link Revoked ${runId}`)

    // Admin creates a link invitation
    const createResult = await invitationsCaller().createLink({
      groupId,
      role: 'MEMBER',
      temporaryName: 'Revocable Guest',
    })
    expect(createResult).toHaveProperty('invitationId')
    expect(createResult).toHaveProperty('inviteUrl')

    // Revoke the invitation
    await invitationsCaller().revoke({
      invitationId: createResult.invitationId,
    })

    // Verify the invitation status is REVOKED in DB
    const revokedInvitation = await prisma.groupInvitation.findUnique({
      where: { id: createResult.invitationId },
    })
    expect(revokedInvitation!.status).toBe('REVOKED')
    expect(revokedInvitation!.revokedAt).not.toBeNull()

    // Extract the token from the URL
    const inviteUrl = new URL(createResult.inviteUrl)
    const token = inviteUrl.searchParams.get('invite')
    expect(token).not.toBeNull()

    // Attempt to accept the revoked link
    await expect(
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).acceptLink({ token: token! }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/revoked/i),
    })

    // Verify the invitee is NOT a group member
    const member = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(member).toBeNull()
  })
})
