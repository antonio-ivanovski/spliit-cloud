import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { hashLinkToken } from '../lib/invitations'
import { groupsRouter } from '../trpc/routers/groups'
import { invitationsRouter } from '../trpc/routers/invitations'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

function getInviteToken(inviteUrl: string) {
  return new URL(inviteUrl).pathname.split('/').at(-1) ?? null
}

describe('Link invitation flow — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-admin-link-${runId}`
  const adminEmail = `admin-link-${runId}@test.example`
  const inviteeId = `acct-invitee-link-${runId}`
  const inviteeEmail = `invitee-link-${runId}@test.example`
  const secondInviteeId = `acct-second-link-${runId}`
  const secondInviteeEmail = `second-link-${runId}@test.example`

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
    await prisma.account.upsert({
      where: { email: secondInviteeEmail },
      update: {},
      create: {
        id: secondInviteeId,
        email: secondInviteeEmail,
        emailVerified: true,
        name: 'Second Invitee',
      },
    })
  })

  afterAll(async () => {
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
    await prisma.account.delete({ where: { id: inviteeId } }).catch(() => {})
    await prisma.account
      .delete({ where: { id: secondInviteeId } })
      .catch(() => {})
  })

  // ------------------------------------------------------------------
  // Helper: create a group and return its ledgerId
  // ------------------------------------------------------------------
  async function createTestGroup(
    name: string,
  ): Promise<{ groupId: string; ledgerId: string }> {
    const caller = adminCaller()
    const { groupId } = await caller.create({
      requestId: crypto.randomUUID(),
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
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
      temporaryName: 'Guest User',
    })
    expect(createResult).toHaveProperty('invitationId')
    expect(createResult).toHaveProperty('inviteUrl')
    expect(createResult.inviteUrl).toMatch(
      /^http:\/\/localhost:3000\/groups\/[a-f0-9]{32}$/,
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
    const token = getInviteToken(createResult.inviteUrl)
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
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    expect(createResult).toHaveProperty('invitationId')
    expect(createResult).toHaveProperty('inviteUrl')

    const token = getInviteToken(createResult.inviteUrl)
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
      requestId: crypto.randomUUID(),
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
    const token = getInviteToken(createResult.inviteUrl)
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

  // ------------------------------------------------------------------
  // 5. Regenerate (rotate) a link credential
  // ------------------------------------------------------------------
  it('regenerates a link: old URL dies, new URL works, identity is preserved', async () => {
    const { groupId } = await createTestGroup(`Link Rotate ${runId}`)

    const createResult = await invitationsCaller().createLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
      temporaryName: 'Rotatable Guest',
    })
    const invitationId = createResult.invitationId
    const invitationBefore = await prisma.groupInvitation.findUnique({
      where: { id: invitationId },
    })
    const oldToken = getInviteToken(createResult.inviteUrl)
    expect(oldToken).not.toBeNull()

    // Rotate.
    const rotated = await invitationsCaller().regenerateLink({ invitationId })
    expect(rotated.inviteUrl).toMatch(/^http:\/\/localhost:3000\/groups\//)

    // Identity preserved: same row id and ledger participant.
    const invitationAfter = await prisma.groupInvitation.findUnique({
      where: { id: invitationId },
    })
    expect(invitationAfter!.id).toBe(invitationId)
    expect(invitationAfter!.ledgerParticipantId).toBe(
      invitationBefore!.ledgerParticipantId,
    )
    expect(invitationAfter!.status).toBe('PENDING')
    expect(invitationAfter!.temporaryName).toBe('Rotatable Guest')
    // Expiry resets to the 30-day TTL (strictly later than the original).
    expect(invitationAfter!.expiresAt).not.toBeNull()
    expect(invitationAfter!.expiresAt!.getTime()).toBeGreaterThan(
      invitationBefore!.expiresAt!.getTime(),
    )
    expect(invitationAfter!.tokenHash).not.toBe(invitationBefore!.tokenHash)

    // The old token is dead: no row matches the old hash anymore.
    const stalePreview = await invitationsCaller().previewLink({
      token: oldToken!,
    })
    expect(stalePreview.preview).toBeNull()
    await expect(
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).acceptLink({ token: oldToken! }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    // The new token works.
    const newToken = getInviteToken(rotated.inviteUrl)
    expect(newToken).not.toBeNull()
    const acceptResult = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token: newToken! })
    expect(acceptResult.groupId).toBe(groupId)

    // Exactly one INVITATION_UPDATED activity, credential rotation only.
    const activities = await prisma.activity.findMany({
      where: {
        ledgerId: (await prisma.group.findUnique({ where: { id: groupId } }))!
          .ledgerId,
        type: 'INVITATION_UPDATED',
      },
    })
    expect(activities).toHaveLength(1)
    expect(activities[0].data).toMatchObject({
      kind: 'invitation',
      changes: [{ field: 'credential', after: 'rotated' }],
    })
  })

  // ------------------------------------------------------------------
  // 6. LINK -> EMAIL conversion
  // ------------------------------------------------------------------
  it('converts a link invitation to email: old link dies, email recipient accepts', async () => {
    const { groupId } = await createTestGroup(`Link To Email ${runId}`)

    const createResult = await invitationsCaller().createLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
      temporaryName: 'Converted Guest',
    })
    const invitationId = createResult.invitationId
    const oldToken = getInviteToken(createResult.inviteUrl)

    const updated = await invitationsCaller().updatePending({
      invitationId,
      role: 'ADMIN',
      temporaryName: 'Converted Guest',
      delivery: { type: 'EMAIL', email: inviteeEmail },
    })

    expect(updated.inviteUrl).toBeNull()
    expect(updated.invitation.type).toBe('EMAIL')
    expect(updated.invitation.email).toBe(inviteeEmail)
    expect(updated.invitation.role).toBe('ADMIN')
    expect(updated.invitation.ledgerParticipantId).toBe(
      (await prisma.groupInvitation.findUnique({
        where: { id: invitationId },
      }))!.ledgerParticipantId,
    )

    // Old link is dead: no row matches the old token hash anymore.
    const stalePreview = await invitationsCaller().previewLink({
      token: oldToken!,
    })
    expect(stalePreview.preview).toBeNull()

    // New recipient accepts with the updated role and name.
    const acceptResult = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).accept({ invitationId })
    expect(acceptResult.groupId).toBe(groupId)
    const member = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(member!.role).toBe('ADMIN')

    // A concurrent stale update now fails: the invitation is ACCEPTED.
    await expect(
      invitationsCaller().updatePending({
        invitationId,
        role: 'MEMBER',
        delivery: { type: 'LINK' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  // ------------------------------------------------------------------
  // 7. EMAIL -> LINK conversion
  // ------------------------------------------------------------------
  it('converts an email invitation to a link: new URL works, email guard rejects old recipient', async () => {
    const { groupId } = await createTestGroup(`Email To Link ${runId}`)

    const { invitationId } = await invitationsCaller().create({
      requestId: crypto.randomUUID(),
      groupId,
      email: inviteeEmail,
      role: 'MEMBER',
    })

    const converted = await invitationsCaller().updatePending({
      invitationId,
      role: 'MEMBER',
      temporaryName: 'Via Link Now',
      delivery: { type: 'LINK' },
    })

    expect(converted.inviteUrl).not.toBeNull()
    expect(converted.invitation.type).toBe('LINK')
    expect(converted.invitation.temporaryName).toBe('Via Link Now')
    // The placeholder row carries the token, never the real email.
    expect(converted.invitation.email).toContain('@link.placeholder.local')

    // The old recipient cannot accept by invitation id anymore.
    await expect(
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).accept({ invitationId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    // The new link works for a different account.
    const token = getInviteToken(converted.inviteUrl)
    const acceptResult = await invitationsCaller({
      accountId: secondInviteeId,
      email: secondInviteeEmail,
    }).acceptLink({ token: token! })
    expect(acceptResult.groupId).toBe(groupId)
  })

  // ------------------------------------------------------------------
  // 8. A pending EMAIL invitation blocks LINK redemption for that user
  // ------------------------------------------------------------------
  it('blocks link redemption while a personal EMAIL invitation is pending', async () => {
    const { groupId } = await createTestGroup(`Link Vs Email ${runId}`)

    // Personal EMAIL invitation for the invitee.
    await invitationsCaller().create({
      requestId: crypto.randomUUID(),
      groupId,
      email: inviteeEmail,
      role: 'MEMBER',
    })

    // Valid LINK invitation for the same group.
    const createResult = await invitationsCaller().createLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    const token = getInviteToken(createResult.inviteUrl)!
    expect(token).not.toBeNull()

    // The invitee cannot redeem the link while the EMAIL invite is
    // pending — accepting would join via the wrong invitation.
    await expect(
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).acceptLink({ token }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/personal email invitation/i),
    })

    // The invitee is not a member and the link is still untouched.
    const member = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
    })
    expect(member).toBeNull()

    // A different account can still redeem the same link.
    const otherAccept = await invitationsCaller({
      accountId: secondInviteeId,
      email: secondInviteeEmail,
    }).acceptLink({ token })
    expect(otherAccept.groupId).toBe(groupId)
  })

  it('allows link redemption once the personal EMAIL invitation is revoked', async () => {
    const { groupId } = await createTestGroup(`Link After Revoke ${runId}`)

    const { invitationId } = await invitationsCaller().create({
      requestId: crypto.randomUUID(),
      groupId,
      email: inviteeEmail,
      role: 'MEMBER',
    })

    const createResult = await invitationsCaller().createLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    const token = getInviteToken(createResult.inviteUrl)!

    // Blocked while pending.
    await expect(
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).acceptLink({ token }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/personal email invitation/i),
    })

    // Admin revokes the personal EMAIL invitation.
    await invitationsCaller().revoke({ invitationId })

    // The invitee can now redeem the link.
    const acceptResult = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token })
    expect(acceptResult.groupId).toBe(groupId)
  })

  // ------------------------------------------------------------------
  // 9. Expired links stay listed and regenerable
  // ------------------------------------------------------------------
  it('keeps an expired link invitation listed and regenerable, old token stays dead', async () => {
    const { groupId } = await createTestGroup(`Link Expired Recover ${runId}`)

    const rawToken = 'expired-recover-' + runId
    const token = rawToken.padEnd(16, 'x')
    const tokenHash = await hashLinkToken(token)
    await prisma.groupInvitation.create({
      data: {
        id: `inv-expired-recover-${runId}`,
        type: 'LINK',
        groupId,
        email: `${token}@link.placeholder.local`,
        role: 'MEMBER',
        invitedById: adminId,
        tokenHash,
        expiresAt: new Date(Date.now() - 1000 * 60 * 60),
      },
    })

    // Still listed as PENDING (never auto-hidden or revoked).
    const listed = await invitationsCaller().list({ groupId })
    const row = listed.invitations.find(
      (inv) => inv.email === `${token}@link.placeholder.local`,
    )
    expect(row).toBeDefined()
    expect(row!.status).toBe('PENDING')
    expect(row!.expiresAt).not.toBeNull()
    expect(new Date(row!.expiresAt!).getTime()).toBeLessThan(Date.now())

    // Regenerate succeeds and resets the expiry into the future.
    const regenerated = await invitationsCaller().regenerateLink({
      invitationId: row!.id,
    })
    expect(regenerated.invitation.status).toBe('PENDING')
    expect(regenerated.invitation.expiresAt).not.toBeNull()
    expect(
      new Date(regenerated.invitation.expiresAt).getTime(),
    ).toBeGreaterThan(Date.now())

    // The old token stays rejected; the new token works.
    await expect(
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).acceptLink({ token }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const newToken = getInviteToken(regenerated.inviteUrl)
    expect(newToken).not.toBeNull()
    const acceptResult = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token: newToken! })
    expect(acceptResult.groupId).toBe(groupId)
  })
})
