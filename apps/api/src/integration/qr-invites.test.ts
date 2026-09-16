import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import {
  QR_INVITATION_DEFAULT_TTL_MS,
  QR_SESSION_MAX_USES,
} from '../lib/invitations/link-invitations'
import { groupsRouter } from '../trpc/routers/groups'
import { invitationsRouter } from '../trpc/routers/invitations'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

function getInviteToken(inviteUrl: string) {
  return new URL(inviteUrl).searchParams.get('invite')
}

describe('QR / nearby session invitations — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-admin-qr-${runId}`
  const adminEmail = `admin-qr-${runId}@test.example`
  const inviteeId = `acct-invitee-qr-${runId}`
  const inviteeEmail = `invitee-qr-${runId}@test.example`
  const secondInviteeId = `acct-second-qr-${runId}`
  const secondInviteeEmail = `second-qr-${runId}@test.example`

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
    const accountId = overrides?.accountId ?? adminId
    return invitationsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: accountId,
          email: overrides?.email ?? adminEmail,
          emailVerified: true,
          name: accountId === adminId ? 'Test Admin' : 'Test Invitee',
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

  it('creates a multi-use QR invitation with a short expiry', async () => {
    const { groupId } = await createTestGroup(`QR Create ${runId}`)
    const before = Date.now()

    const result = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })

    expect(result.inviteUrl).toMatch(
      /^http:\/\/localhost:3000\/groups\/[^/?]+\?invite=/,
    )
    expect(result.isMultiUse).toBe(true)
    expect(result.useCount).toBe(0)

    const invitation = await prisma.groupInvitation.findUnique({
      where: { id: result.invitationId },
    })
    expect(invitation).not.toBeNull()
    expect(invitation!.type).toBe('LINK')
    expect(invitation!.status).toBe('PENDING')
    expect(invitation!.isMultiUse).toBe(true)
    expect(invitation!.useCount).toBe(0)
    // No named invitee: nothing to attribute pre-accept expenses to.
    expect(invitation!.temporaryName).toBeNull()
    expect(invitation!.ledgerParticipantId).toBeNull()

    const ttl = invitation!.expiresAt!.getTime() - before
    // Server-side expiry is stamped after `before`; allow RPC clock skew.
    expect(ttl).toBeGreaterThanOrEqual(QR_INVITATION_DEFAULT_TTL_MS)
    expect(ttl).toBeLessThanOrEqual(QR_INVITATION_DEFAULT_TTL_MS + 60_000)
  })

  it('lets any number of accounts join with the same QR token', async () => {
    const { groupId, ledgerId } = await createTestGroup(`QR Multi ${runId}`)
    const { inviteUrl } = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    const token = getInviteToken(inviteUrl)
    expect(token).not.toBeNull()

    const first = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token: token! })
    expect(first.groupId).toBe(groupId)

    const second = await invitationsCaller({
      accountId: secondInviteeId,
      email: secondInviteeEmail,
    }).acceptLink({ token: token! })
    expect(second.groupId).toBe(groupId)

    // The session stays open and counts joins.
    const invitation = await prisma.groupInvitation.findFirst({
      where: { groupId, isMultiUse: true },
    })
    expect(invitation!.status).toBe('PENDING')
    expect(invitation!.useCount).toBe(2)

    // Both joiners are active members with their own ledger participants.
    const members = await prisma.groupMember.findMany({
      where: { groupId, status: 'ACTIVE' },
      select: { accountId: true, ledgerParticipant: { select: { id: true } } },
    })
    const joiners = members.filter((m) =>
      [inviteeId, secondInviteeId].includes(m.accountId),
    )
    expect(joiners).toHaveLength(2)
    const participantIds = new Set(joiners.map((m) => m.ledgerParticipant?.id))
    expect(participantIds.size).toBe(2)

    // Every participant belongs to the group ledger.
    for (const id of participantIds) {
      const participant = await prisma.ledgerParticipant.findUnique({
        where: { id: id! },
        select: { ledgerId: true },
      })
      expect(participant!.ledgerId).toBe(ledgerId)
    }
  })

  it('rejects a second accept by the same account', async () => {
    const { groupId } = await createTestGroup(`QR Double ${runId}`)
    const { inviteUrl } = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    const token = getInviteToken(inviteUrl)!

    await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token })

    await expect(
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).acceptLink({ token }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/already a member/i),
    })
  })

  it('reports multi-use state in the public preview', async () => {
    const { groupId } = await createTestGroup(`QR Preview ${runId}`)
    const { inviteUrl } = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    const token = getInviteToken(inviteUrl)!

    const before = await invitationsCaller().previewLink({ token })
    expect(before.preview).toMatchObject({
      usable: true,
      isMultiUse: true,
      useCount: 0,
    })

    await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token })

    // Still usable after a join — that is the point of the session.
    const after = await invitationsCaller().previewLink({ token })
    expect(after.preview).toMatchObject({
      usable: true,
      isMultiUse: true,
      useCount: 1,
    })
  })

  it('rejects acceptance of a revoked QR invitation', async () => {
    const { groupId } = await createTestGroup(`QR Revoked ${runId}`)
    const { invitationId, inviteUrl } = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    const token = getInviteToken(inviteUrl)!

    await invitationsCaller().revoke({ invitationId })

    await expect(
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).acceptLink({ token }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/revoked/i),
    })
  })

  it('keeps the short TTL when a QR session link is regenerated', async () => {
    const { groupId } = await createTestGroup(`QR Rotate ${runId}`)
    const { invitationId, inviteUrl } = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    const oldToken = getInviteToken(inviteUrl)!

    const rotated = await invitationsCaller().regenerateLink({ invitationId })
    expect(rotated.invitation.isMultiUse).toBe(true)
    const ttl = new Date(rotated.invitation.expiresAt!).getTime() - Date.now()
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(QR_INVITATION_DEFAULT_TTL_MS)

    // Old token is dead, new token works — twice.
    await expect(
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).acceptLink({ token: oldToken }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const newToken = getInviteToken(rotated.inviteUrl)!
    await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token: newToken })
    await invitationsCaller({
      accountId: secondInviteeId,
      email: secondInviteeEmail,
    }).acceptLink({ token: newToken })
  })

  it('rejects a second QR session while one is active', async () => {
    const { groupId } = await createTestGroup(`QR Single ${runId}`)
    await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })

    await expect(
      invitationsCaller().createQrLink({
        requestId: crypto.randomUUID(),
        groupId,
        role: 'MEMBER',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/already active/i),
    })
  })

  it('allows a new QR session after the previous one is revoked', async () => {
    const { groupId } = await createTestGroup(`QR AfterRevoke ${runId}`)
    const { invitationId } = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    await invitationsCaller().revoke({ invitationId })

    const again = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    expect(again.invitationId).not.toBe(invitationId)
    expect(again.isMultiUse).toBe(true)
  })

  it('lists QR session joiners oldest-first with account names', async () => {
    const { groupId } = await createTestGroup(`QR Joiners ${runId}`)
    const { invitationId, inviteUrl } = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    const token = getInviteToken(inviteUrl)!

    await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token })
    await invitationsCaller({
      accountId: secondInviteeId,
      email: secondInviteeEmail,
    }).acceptLink({ token })

    const { invitations } = await invitationsCaller().list({ groupId })
    const session = invitations.find((i) => i.id === invitationId)
    expect(session).toBeDefined()
    expect(session!.useCount).toBe(2)
    expect(session!.recentJoiners).toHaveLength(2)
    expect(session!.recentJoiners[0]).toMatchObject({
      accountId: inviteeId,
      name: 'Test Invitee',
    })
    expect(session!.recentJoiners[1]).toMatchObject({
      accountId: secondInviteeId,
      name: 'Second Invitee',
    })
    expect(session!.recentJoiners[0]!.joinedAt.getTime()).toBeLessThanOrEqual(
      session!.recentJoiners[1]!.joinedAt.getTime(),
    )
  })

  it('shows the active QR session to non-creator members', async () => {
    const { groupId } = await createTestGroup(`QR Visible ${runId}`)
    const { inviteUrl } = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    const token = getInviteToken(inviteUrl)!

    // A joiner becomes a plain member (not the session creator).
    await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token })

    // They still see the live session (without manage/revoke rights), so a
    // second Show QR converges on the summary instead of a CONFLICT wall.
    const { invitations } = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).list({ groupId })
    const session = invitations.find((i) => i.isMultiUse)
    expect(session).toBeDefined()
    expect(session!.useCount).toBe(1)
    expect(session!.canManage).toBe(false)
    expect(session!.canRevoke).toBe(false)
  })

  it('reports empty joiners for a fresh QR session', async () => {
    const { groupId } = await createTestGroup(`QR NoJoiners ${runId}`)
    const { invitationId } = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })

    const { invitations } = await invitationsCaller().list({ groupId })
    const session = invitations.find((i) => i.id === invitationId)
    expect(session!.recentJoiners).toEqual([])
  })

  it('rejects ADMIN role for QR sessions', async () => {
    const { groupId } = await createTestGroup(`QR AdminRole ${runId}`)

    await expect(
      invitationsCaller().createQrLink({
        requestId: crypto.randomUUID(),
        groupId,
        role: 'ADMIN',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('never exposes the join credential in the list response', async () => {
    const { groupId } = await createTestGroup(`QR NoLeak ${runId}`)
    const { invitationId, inviteUrl } = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    const token = getInviteToken(inviteUrl)!

    // A joiner becomes a plain member and still sees the live session.
    await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token })

    for (const viewer of [
      invitationsCaller(),
      invitationsCaller({ accountId: inviteeId, email: inviteeEmail }),
    ]) {
      const { invitations } = await viewer.list({ groupId })
      const session = invitations.find((i) => i.id === invitationId)
      expect(session).toBeDefined()
      // The placeholder email must not encode the raw token — otherwise any
      // member could reconstruct the join URL from this response.
      expect(session!.email).not.toContain(token)
    }
  })

  it('counts concurrent same-account accepts only once', async () => {
    const { groupId } = await createTestGroup(`QR Concurrent ${runId}`)
    const { inviteUrl } = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    const token = getInviteToken(inviteUrl)!
    const join = () =>
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).acceptLink({ token })

    const results = await Promise.allSettled([join(), join()])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)

    // The losing transaction rolls back its increment: one joiner, one count.
    const invitation = await prisma.groupInvitation.findFirst({
      where: { groupId, isMultiUse: true },
    })
    expect(invitation!.useCount).toBe(1)
    const { invitations } = await invitationsCaller().list({ groupId })
    const session = invitations.find((i) => i.id === invitation!.id)
    expect(session!.recentJoiners).toHaveLength(1)
  })

  it('treats a full session as dead: rejects joins, hides it, allows a new session', async () => {
    const { groupId } = await createTestGroup(`QR Full ${runId}`)
    const { invitationId, inviteUrl } = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    const token = getInviteToken(inviteUrl)!
    await prisma.groupInvitation.update({
      where: { id: invitationId },
      data: { useCount: QR_SESSION_MAX_USES },
    })

    await expect(
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).acceptLink({ token }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/full/i),
    })

    const { invitations } = await invitationsCaller().list({ groupId })
    expect(invitations.find((i) => i.id === invitationId)).toBeUndefined()

    const again = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    expect(again.invitationId).not.toBe(invitationId)
  })

  it('hides expired QR sessions from the list', async () => {
    const { groupId } = await createTestGroup(`QR Expired ${runId}`)
    const { invitationId } = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    await prisma.groupInvitation.update({
      where: { id: invitationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const { invitations } = await invitationsCaller().list({ groupId })
    expect(invitations.find((i) => i.id === invitationId)).toBeUndefined()
  })

  it('resets the join counter when a QR session link is regenerated', async () => {
    const { groupId } = await createTestGroup(`QR RotateCount ${runId}`)
    const { invitationId, inviteUrl } = await invitationsCaller().createQrLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    const token = getInviteToken(inviteUrl)!
    await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token })

    const rotated = await invitationsCaller().regenerateLink({ invitationId })
    expect(rotated.invitation.useCount).toBe(0)
  })
})
