import { it as effectIt } from '@effect/vitest'
import { Effect, Fiber, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma, type Prisma } from '@spliit/db'

import { InvitationRepository } from '../lib/invitations/effects/repository'
import { InviteLiveTokens } from '../lib/invitations/effects/tokens'
import { acceptInvitationEffect } from '../lib/invitations/email-completion'
import { acceptLinkInvitationEffect } from '../lib/invitations/link-invitations'
import {
  SHARED_LINK_DEFAULT_MAX_USES,
  SHARED_LINK_DEFAULT_TTL_MS,
  SHARED_LINK_MAX_PENDING_PER_GROUP,
} from '../lib/invitations/link-invitations'
import { getSharedLinkUrlEffect } from '../lib/invitations/manage-invitations'
import { groupsRouter } from '../trpc/routers/groups'
import { invitationsRouter } from '../trpc/routers/invitations'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

function getInviteToken(inviteUrl: string) {
  return new URL(inviteUrl).searchParams.get('invite')
}

describe('Shared (multi-person) link invitations — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-admin-shared-${runId}`
  const adminEmail = `admin-shared-${runId}@test.example`
  const inviteeId = `acct-invitee-shared-${runId}`
  const inviteeEmail = `invitee-shared-${runId}@test.example`
  const secondInviteeId = `acct-second-shared-${runId}`
  const secondInviteeEmail = `second-shared-${runId}@test.example`
  const thirdInviteeId = `acct-third-shared-${runId}`
  const thirdInviteeEmail = `third-shared-${runId}@test.example`

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
    for (const [id, email, name] of [
      [adminId, adminEmail, 'Test Admin'],
      [inviteeId, inviteeEmail, 'Test Invitee'],
      [secondInviteeId, secondInviteeEmail, 'Second Invitee'],
      [thirdInviteeId, thirdInviteeEmail, 'Third Invitee'],
    ] as const) {
      await prisma.user.upsert({
        where: { email },
        update: {},
        create: { id, email, emailVerified: true, name },
      })
    }
  })

  afterAll(async () => {
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    for (const id of [adminId, inviteeId, secondInviteeId, thirdInviteeId]) {
      await prisma.user.delete({ where: { id } }).catch(() => {})
    }
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

  it('creates a shared link with defaults: MEMBER, unlimited joins, 7 days, labelled', async () => {
    const { groupId } = await createTestGroup(`Shared Create ${runId}`)
    const before = Date.now()

    const result = await invitationsCaller().createSharedLink({
      requestId: crypto.randomUUID(),
      groupId,
      label: 'Family chat',
    })

    expect(result.isShared).toBe(true)
    expect(result.isMultiUse).toBe(true)
    expect(result.role).toBe('MEMBER')
    expect(result.useCount).toBe(0)
    expect(result.maxUses).toBe(SHARED_LINK_DEFAULT_MAX_USES)
    expect(result.label).toBe('Family chat')
    expect(result.inviteUrl).toMatch(
      /^http:\/\/localhost:3000\/groups\/[^/?]+\?invite=/,
    )

    const invitation = await prisma.groupInvitation.findUnique({
      where: { id: result.invitationId },
    })
    expect(invitation).toMatchObject({
      type: 'LINK',
      status: 'PENDING',
      isMultiUse: true,
      role: 'MEMBER',
    })
    // No named invitee, no pre-accept participant; the raw token is stored
    // for member copy-anytime, and the placeholder never encodes it.
    expect(invitation!.temporaryName).toBeNull()
    expect(invitation!.ledgerParticipantId).toBeNull()
    expect(invitation!.linkToken).not.toBeNull()
    expect(invitation!.email).not.toContain(invitation!.linkToken!)

    const ttl = invitation!.expiresAt!.getTime() - before
    expect(ttl).toBeGreaterThanOrEqual(SHARED_LINK_DEFAULT_TTL_MS)
    expect(ttl).toBeLessThanOrEqual(SHARED_LINK_DEFAULT_TTL_MS + 60_000)
  })

  it('accepts explicit caps and unlimited for both axes', async () => {
    const { groupId } = await createTestGroup(`Shared Caps ${runId}`)

    const capped = await invitationsCaller().createSharedLink({
      requestId: crypto.randomUUID(),
      groupId,
      maxUses: 25,
      expiresIn: { amount: 2, unit: 'weeks' },
    })
    expect(capped.maxUses).toBe(25)
    const cappedRow = await prisma.groupInvitation.findUnique({
      where: { id: capped.invitationId },
    })
    const cappedTtl = cappedRow!.expiresAt!.getTime() - Date.now()
    expect(cappedTtl).toBeGreaterThan(13 * 24 * 60 * 60 * 1000)
    expect(cappedTtl).toBeLessThanOrEqual(14 * 24 * 60 * 60 * 1000 + 60_000)

    const open = await invitationsCaller().createSharedLink({
      requestId: crypto.randomUUID(),
      groupId,
      maxUses: null,
      expiresIn: null,
    })
    expect(open.maxUses).toBeNull()
    const openRow = await prisma.groupInvitation.findUnique({
      where: { id: open.invitationId },
    })
    expect(openRow!.expiresAt).toBeNull()
  })

  it('rejects out-of-range limits', async () => {
    const { groupId } = await createTestGroup(`Shared Bounds ${runId}`)

    await expect(
      invitationsCaller().createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
        maxUses: 1,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    await expect(
      invitationsCaller().createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
        maxUses: 1001,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    await expect(
      invitationsCaller().createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
        expiresIn: { amount: 53, unit: 'weeks' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    await expect(
      invitationsCaller().createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
        label: 'x'.repeat(41),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('lets several accounts join with the same token and counts uses', async () => {
    const { groupId } = await createTestGroup(`Shared Multi ${runId}`)
    const { inviteUrl, invitationId } =
      await invitationsCaller().createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
        maxUses: 5,
      })
    const token = getInviteToken(inviteUrl)!

    const first = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token })
    expect(first.groupId).toBe(groupId)
    expect(first.role).toBe('MEMBER')

    const second = await invitationsCaller({
      accountId: secondInviteeId,
      email: secondInviteeEmail,
    }).acceptLink({ token })
    expect(second.groupId).toBe(groupId)

    const invitation = await prisma.groupInvitation.findUnique({
      where: { id: invitationId },
    })
    expect(invitation!.status).toBe('PENDING')
    expect(invitation!.useCount).toBe(2)
  })

  it('closes the link at the join cap with a full reason', async () => {
    const { groupId } = await createTestGroup(`Shared Full ${runId}`)
    const { invitationId, inviteUrl } =
      await invitationsCaller().createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
        maxUses: 2,
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

    // The N+1th join is rejected with the join-limit message.
    await expect(
      invitationsCaller({
        accountId: thirdInviteeId,
        email: thirdInviteeEmail,
      }).acceptLink({ token }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/join limit/i),
    })

    // Preview reports full (distinct from expired); the row stays PENDING
    // so it can be revived by raising the cap.
    const { preview } = await invitationsCaller().previewLink({ token })
    expect(preview).toMatchObject({
      usable: false,
      reason: 'full',
      useCount: 2,
      maxUses: 2,
    })
    const row = await prisma.groupInvitation.findUnique({
      where: { id: invitationId },
    })
    expect(row!.status).toBe('PENDING')

    // List still shows the ended link with the full reason (clean-up/edit).
    const { invitations } = await invitationsCaller().list({ groupId })
    const listed = invitations.find((i) => i.id === invitationId)
    expect(listed).toMatchObject({
      isShared: true,
      endedReason: 'full',
      canCopyLink: false,
    })
  })

  it('does not consume a use for an already-active member', async () => {
    const { groupId } = await createTestGroup(`Shared Rejoin ${runId}`)
    const { inviteUrl } = await invitationsCaller().createSharedLink({
      requestId: crypto.randomUUID(),
      groupId,
      maxUses: 5,
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
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    const row = await prisma.groupInvitation.findFirst({
      where: { groupId, isMultiUse: true, linkToken: { not: null } },
    })
    expect(row!.useCount).toBe(1)
  })

  it('retrieves the URL for any active member, never in the list payload', async () => {
    const { groupId } = await createTestGroup(`Shared Copy ${runId}`)
    const { invitationId, inviteUrl } =
      await invitationsCaller().createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
        label: 'Discord',
      })
    const token = getInviteToken(inviteUrl)!

    // A joiner becomes a plain member and can still copy the live link.
    await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token })

    for (const viewer of [
      invitationsCaller(),
      invitationsCaller({ accountId: inviteeId, email: inviteeEmail }),
    ]) {
      const { invitations } = await viewer.list({ groupId })
      const listed = invitations.find((i) => i.id === invitationId)
      expect(listed).toMatchObject({
        isShared: true,
        label: 'Discord',
        canCopyLink: true,
        endedReason: null,
      })
      // The raw token never appears in the list response object.
      expect(listed).not.toHaveProperty('linkToken')
      expect(JSON.stringify(listed)).not.toContain(token)
    }

    const copied = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).getLinkUrl({ groupId, invitationId })
    expect(copied.inviteUrl).toBe(inviteUrl)
    expect(copied.label).toBe('Discord')

    // One-time links are never retrievable through this endpoint.
    const oneTime = await invitationsCaller().createLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    await expect(
      invitationsCaller().getLinkUrl({
        groupId,
        invitationId: oneTime.invitationId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('edits label, cap, and expiry; lowering the cap below useCount ends the link', async () => {
    const { groupId } = await createTestGroup(`Shared Edit ${runId}`)
    const { invitationId, inviteUrl } =
      await invitationsCaller().createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
        maxUses: 10,
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

    const before = Date.now()
    const updated = await invitationsCaller().updatePending({
      invitationId,
      role: 'MEMBER',
      delivery: { type: 'LINK' },
      shared: {
        label: 'Renamed',
        maxUses: 5,
        expiresIn: { amount: 3, unit: 'days' },
      },
    })
    expect(updated.invitation).toMatchObject({
      isShared: true,
      label: 'Renamed',
      maxUses: 5,
      useCount: 2,
      endedReason: null,
    })
    const ttl = new Date(updated.invitation.expiresAt!).getTime() - before
    expect(ttl).toBeGreaterThan(2 * 24 * 60 * 60 * 1000)
    expect(ttl).toBeLessThanOrEqual(3 * 24 * 60 * 60 * 1000 + 60_000)

    // Lowering the cap at/below current usage ends the link immediately.
    const ended = await invitationsCaller().updatePending({
      invitationId,
      role: 'MEMBER',
      delivery: { type: 'LINK' },
      shared: { maxUses: 2 },
    })
    expect(ended.invitation).toMatchObject({ endedReason: 'full' })
    await expect(
      invitationsCaller({
        accountId: thirdInviteeId,
        email: thirdInviteeEmail,
      }).acceptLink({ token }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/join limit/i),
    })

    // Raising it again revives the link.
    const revived = await invitationsCaller().updatePending({
      invitationId,
      role: 'MEMBER',
      delivery: { type: 'LINK' },
      shared: { maxUses: 4 },
    })
    expect(revived.invitation).toMatchObject({ endedReason: null })
    const join = await invitationsCaller({
      accountId: thirdInviteeId,
      email: thirdInviteeEmail,
    }).acceptLink({ token })
    expect(join.groupId).toBe(groupId)
  })

  it('rotates only the credential: count, expiry, label, and cap survive', async () => {
    const { groupId } = await createTestGroup(`Shared Rotate ${runId}`)
    const { invitationId, inviteUrl } =
      await invitationsCaller().createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
        label: 'Keep me',
        maxUses: 10,
      })
    const oldToken = getInviteToken(inviteUrl)!
    await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token: oldToken })

    const before = await prisma.groupInvitation.findUnique({
      where: { id: invitationId },
    })
    const rotated = await invitationsCaller().regenerateLink({ invitationId })
    expect(rotated.invitation).toMatchObject({
      isShared: true,
      label: 'Keep me',
      maxUses: 10,
      useCount: 1,
    })
    expect(new Date(rotated.invitation.expiresAt!).getTime()).toBe(
      before!.expiresAt!.getTime(),
    )

    // Old URL is dead; new URL works; copy-anytime serves the new URL.
    // (A rotated-away credential no longer hashes to any row, so the accept
    // reports the link as not found — the same code an unknown URL gets.)
    await expect(
      invitationsCaller({
        accountId: secondInviteeId,
        email: secondInviteeEmail,
      }).acceptLink({ token: oldToken }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const newToken = getInviteToken(rotated.inviteUrl)!
    expect(newToken).not.toBe(oldToken)
    await invitationsCaller({
      accountId: secondInviteeId,
      email: secondInviteeEmail,
    }).acceptLink({ token: newToken })
    const copied = await invitationsCaller().getLinkUrl({
      groupId,
      invitationId,
    })
    expect(copied.inviteUrl).toBe(rotated.inviteUrl)
  })

  it('lets the creator revoke after joins and clears the stored token', async () => {
    const { groupId } = await createTestGroup(`Shared Revoke ${runId}`)
    // A non-admin member creates the link (any member may create MEMBER).
    const memberCaller = invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    })
    // The invitee must be a member first: join via an admin-made link.
    const seed = await invitationsCaller().createLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    await memberCaller.acceptLink({ token: getInviteToken(seed.inviteUrl)! })

    const { invitationId, inviteUrl } = await memberCaller.createSharedLink({
      requestId: crypto.randomUUID(),
      groupId,
    })
    const token = getInviteToken(inviteUrl)!
    await invitationsCaller({
      accountId: secondInviteeId,
      email: secondInviteeEmail,
    }).acceptLink({ token })

    // The creator (non-admin) can revoke even after the link was used.
    await memberCaller.revoke({ invitationId })
    const row = await prisma.groupInvitation.findUnique({
      where: { id: invitationId },
    })
    expect(row!.status).toBe('REVOKED')
    expect(row!.linkToken).toBeNull()

    await expect(
      invitationsCaller({
        accountId: thirdInviteeId,
        email: thirdInviteeEmail,
      }).acceptLink({ token }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/revoked/i),
    })
    await expect(
      memberCaller.getLinkUrl({ groupId, invitationId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('enforces the pending shared-link quota per group', async () => {
    const { groupId } = await createTestGroup(`Shared Cap ${runId}`)
    for (let i = 0; i < SHARED_LINK_MAX_PENDING_PER_GROUP; i++) {
      await invitationsCaller().createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
      })
    }
    await expect(
      invitationsCaller().createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringMatching(/already has/i),
    })
  })

  it('unlimited shared links never fill up: no cap at 30 joins', async () => {
    const { groupId } = await createTestGroup(`Shared Unlimited ${runId}`)
    const { inviteUrl } = await invitationsCaller().createSharedLink({
      requestId: crypto.randomUUID(),
      groupId,
      maxUses: null,
      expiresIn: null,
    })
    const token = getInviteToken(inviteUrl)!

    // Preview stays usable at and beyond the old hardcoded QR cap.
    const row = await prisma.groupInvitation.findFirst({
      where: { groupId, isMultiUse: true, linkToken: { not: null } },
    })
    await prisma.groupInvitation.update({
      where: { id: row!.id },
      data: { useCount: 30 },
    })
    const { preview } = await invitationsCaller().previewLink({ token })
    expect(preview).toMatchObject({
      usable: true,
      reason: null,
      useCount: 30,
      maxUses: null,
    })

    // …and the list agrees (no `full`, copy still allowed).
    const { invitations } = await invitationsCaller().list({ groupId })
    const listed = invitations.find((i) => i.id === row!.id)
    expect(listed).toMatchObject({
      isShared: true,
      endedReason: null,
      canCopyLink: true,
    })

    // …and the accept gate agrees (a fresh account can still join).
    const join = await invitationsCaller({
      accountId: thirdInviteeId,
      email: thirdInviteeEmail,
    }).acceptLink({ token })
    expect(join.groupId).toBe(groupId)
    const after = await prisma.groupInvitation.findUnique({
      where: { id: row!.id },
    })
    expect(after!.useCount).toBe(31)
  })

  it('label-only edits leave expiry and cap untouched', async () => {
    const { groupId } = await createTestGroup(`Shared Untouched ${runId}`)
    const { invitationId } = await invitationsCaller().createSharedLink({
      requestId: crypto.randomUUID(),
      groupId,
      label: 'Before',
      maxUses: 10,
      expiresIn: { amount: 3, unit: 'days' },
    })
    const before = await prisma.groupInvitation.findUnique({
      where: { id: invitationId },
    })

    // A label-only save (`shared: { label }`, no expiry or cap fields)
    // must not clear the link's expiry or cap.
    const updated = await invitationsCaller().updatePending({
      invitationId,
      role: 'MEMBER',
      delivery: { type: 'LINK' },
      shared: { label: 'After' },
    })
    expect(updated.invitation).toMatchObject({
      isShared: true,
      label: 'After',
      maxUses: 10,
    })
    expect(new Date(updated.invitation.expiresAt!).getTime()).toBe(
      before!.expiresAt!.getTime(),
    )
  })

  it('copying a shared URL twice returns the same minted URL', async () => {
    const { groupId } = await createTestGroup(`Shared CopyStable ${runId}`)
    // The invitee must be a member first: only active members may copy.
    const seed = await invitationsCaller().createLink({
      requestId: crypto.randomUUID(),
      groupId,
      role: 'MEMBER',
    })
    await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token: getInviteToken(seed.inviteUrl)! })

    const { invitationId, inviteUrl } =
      await invitationsCaller().createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
        label: 'Stable',
      })

    // The second copy reads the stored plaintext, not a re-derivation.
    for (const viewer of [
      invitationsCaller(),
      invitationsCaller({ accountId: inviteeId, email: inviteeEmail }),
    ]) {
      const copied = await viewer.getLinkUrl({ groupId, invitationId })
      expect(copied.inviteUrl).toBe(inviteUrl)
    }
  })
  it('reports an expired shared link consistently: preview, list, copy, accept', async () => {
    const { groupId } = await createTestGroup(`Shared Expired ${runId}`)
    const { invitationId, inviteUrl } =
      await invitationsCaller().createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
        label: 'Old news',
        maxUses: 10,
      })
    const token = getInviteToken(inviteUrl)!
    await prisma.groupInvitation.update({
      where: { id: invitationId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })

    // Preview reports expired (distinct from full); the row stays PENDING
    // so it can be revived by extending the expiry.
    const { preview } = await invitationsCaller().previewLink({ token })
    expect(preview).toMatchObject({
      usable: false,
      reason: 'expired',
      isShared: true,
    })

    // List still shows the ended link with the expired reason, but no copy.
    const { invitations } = await invitationsCaller().list({ groupId })
    const listed = invitations.find((i) => i.id === invitationId)
    expect(listed).toMatchObject({
      isShared: true,
      endedReason: 'expired',
      canCopyLink: false,
    })

    // Copy refuses the dead link; accept reports the expired wording.
    await expect(
      invitationsCaller().getLinkUrl({ groupId, invitationId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).acceptLink({ token }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/expired/i),
    })

    // Extending the expiry revives the link.
    const revived = await invitationsCaller().updatePending({
      invitationId,
      role: 'MEMBER',
      delivery: { type: 'LINK' },
      shared: { expiresIn: { amount: 3, unit: 'days' } },
    })
    expect(revived.invitation).toMatchObject({ endedReason: null })
    const join = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token })
    expect(join.groupId).toBe(groupId)
  })

  it('shows shared links to non-creator members with copy but no manage rights', async () => {
    const { groupId } = await createTestGroup(`Shared Visible ${runId}`)
    const { invitationId, inviteUrl } =
      await invitationsCaller().createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
      })
    const token = getInviteToken(inviteUrl)!
    await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).acceptLink({ token })

    const { invitations } = await invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    }).list({ groupId })
    const listed = invitations.find((i) => i.id === invitationId)
    expect(listed).toMatchObject({
      isShared: true,
      canCopyLink: true,
      canManage: false,
      canRevoke: false,
    })
  })

  function viewerCaller(accountId = inviteeId, email = inviteeEmail) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'landing-session' },
        user: {
          id: accountId,
          email,
          emailVerified: true,
          name: 'Landing Viewer',
        },
      },
    } as never)
  }

  async function holdWrite(
    write: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) {
    let release!: () => void
    let locked!: (pid: number) => void
    let rejectReady!: (error: unknown) => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<number>((resolve, reject) => {
      locked = resolve
      rejectReady = reject
    })
    const pending = prisma.$transaction(
      async (tx) => {
        await write(tx)
        const [connection] = await tx.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`
        locked(connection!.pid)
        await gate
      },
      { timeout: 10_000 },
    )
    void pending.catch(rejectReady)
    const pid = await ready
    return { release, pending, pid }
  }

  async function holdInviteEdit(
    id: string,
    data: { expiresAt?: Date; maxUses?: number | null },
  ) {
    return holdWrite((tx) => tx.groupInvitation.update({ where: { id }, data }))
  }

  async function waitForBlockedInviteWrite(blocker: number, minimum = 1) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const rows = await prisma.$queryRaw<
        Array<{ count: number }>
      >`WITH RECURSIVE blocked AS (SELECT pid FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))) SELECT count(DISTINCT pid)::int AS count FROM blocked`
      if (rows[0]!.count >= minimum) return true
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return false
  }

  it.each([2, 20, null])(
    'uses the committed cap %s after a concurrent edit',
    async (maxUses) => {
      const { groupId } = await createTestGroup(`Concurrent cap ${runId}`)
      const created = await invitationsCaller().createSharedLink({
        groupId,
        requestId: crypto.randomUUID(),
        maxUses: 10,
      })
      await prisma.groupInvitation.update({
        where: { id: created.invitationId },
        data: { useCount: 2 },
      })
      const edit = await holdInviteEdit(created.invitationId, { maxUses })
      const accepting = invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      })
        .acceptLink({ token: getInviteToken(created.inviteUrl)! })
        .then(
          () => true,
          () => false,
        )
      let waiting = false
      try {
        waiting = await waitForBlockedInviteWrite(edit.pid)
      } finally {
        edit.release()
      }
      await edit.pending
      const accepted = await accepting
      expect(waiting).toBe(true)
      const shouldJoin = maxUses !== 2
      expect(accepted).toBe(shouldJoin)
      const row = await prisma.groupInvitation.findUniqueOrThrow({
        where: { id: created.invitationId },
      })
      expect(row).toMatchObject({ maxUses, useCount: shouldJoin ? 3 : 2 })
      expect(
        await prisma.groupMember.count({
          where: { groupId, accountId: inviteeId },
        }),
      ).toBe(shouldJoin ? 1 : 0)
      expect(
        await prisma.activity.count({
          where: {
            subjectId: created.invitationId,
            type: 'INVITATION_ACCEPTED',
          },
        }),
      ).toBe(shouldJoin ? 1 : 0)
    },
  )

  it('rotation preserves a concurrently edited expiry', async () => {
    const { groupId } = await createTestGroup(`Concurrent rotation ${runId}`)
    const created = await invitationsCaller().createSharedLink({
      groupId,
      requestId: crypto.randomUUID(),
    })
    const shortened = new Date(Date.now() + 2 * 60 * 60 * 1000)
    const edit = await holdInviteEdit(created.invitationId, {
      expiresAt: shortened,
    })
    const rotating = invitationsCaller().regenerateLink({
      invitationId: created.invitationId,
    })
    let waiting = false
    try {
      waiting = await waitForBlockedInviteWrite(edit.pid)
    } finally {
      edit.release()
    }
    await edit.pending
    const rotated = await rotating
    expect(waiting).toBe(true)
    expect(rotated.invitation.expiresAt?.getTime()).toBe(shortened.getTime())
  })

  it.each(['member', 'public view', 'email invite'])(
    'does not redeem another group’s token when reading through %s',
    async (access) => {
      const { groupId: groupA } = await createTestGroup(`Read A ${runId}`)
      const { groupId: groupB } = await createTestGroup(`Unrelated B ${runId}`)
      let viewKey: string | undefined
      if (access === 'member') {
        const linkA = await invitationsCaller().createLink({
          groupId: groupA,
          requestId: crypto.randomUUID(),
        })
        await invitationsCaller({
          accountId: inviteeId,
          email: inviteeEmail,
        }).acceptLink({ token: getInviteToken(linkA.inviteUrl)! })
      } else if (access === 'public view') {
        viewKey = crypto.randomUUID()
        await prisma.group.update({
          where: { id: groupA },
          data: { publicViewKey: viewKey },
        })
      } else {
        await invitationsCaller().create({
          groupId: groupA,
          requestId: crypto.randomUUID(),
          email: inviteeEmail,
          role: 'MEMBER',
        })
      }
      const linkB = await invitationsCaller().createLink({
        groupId: groupB,
        requestId: crypto.randomUUID(),
      })
      const viewed = await viewerCaller().get({
        groupId: groupA,
        viewKey,
        linkInviteToken: getInviteToken(linkB.inviteUrl)!,
      })
      expect(viewed.group.id).toBe(groupA)
      expect(
        await prisma.groupMember.count({
          where: { groupId: groupB, accountId: inviteeId },
        }),
      ).toBe(0)
      expect(
        await prisma.groupInvitation.findUniqueOrThrow({
          where: { id: linkB.invitationId },
        }),
      ).toMatchObject({ status: 'PENDING', useCount: 0 })
    },
  )

  it('acceptance mutations reject both link and email invitations for another destination group', async () => {
    const { groupId } = await createTestGroup(`Accept target ${runId}`)
    const { groupId: wrongGroupId } = await createTestGroup(
      `Wrong target ${runId}`,
    )
    const link = await invitationsCaller().createSharedLink({
      groupId,
      requestId: crypto.randomUUID(),
    })
    const email = await invitationsCaller().create({
      groupId,
      requestId: crypto.randomUUID(),
      email: inviteeEmail,
      role: 'MEMBER',
    })
    const invitee = invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    })
    await expect(
      invitee.acceptLink({
        token: getInviteToken(link.inviteUrl)!,
        expectedGroupId: wrongGroupId,
      }),
    ).rejects.toBeDefined()
    await expect(
      invitee.accept({
        invitationId: email.invitationId,
        expectedGroupId: wrongGroupId,
      }),
    ).rejects.toBeDefined()
    expect(
      await prisma.groupMember.count({
        where: { groupId, accountId: inviteeId },
      }),
    ).toBe(0)
    expect(
      await prisma.groupInvitation.findUniqueOrThrow({
        where: { id: link.invitationId },
      }),
    ).toMatchObject({ status: 'PENDING', useCount: 0 })
    expect(
      await prisma.groupInvitation.findUniqueOrThrow({
        where: { id: email.invitationId },
      }),
    ).toMatchObject({ status: 'PENDING' })
  })

  it.each([
    ['accept', 'revoked'],
    ['accept', 'retargeted'],
    ['decline', 'revoked'],
    ['decline', 'retargeted'],
  ] as const)(
    'does not %s an email invitation %s while completion waits for its row',
    async (operation, change) => {
      const { groupId } = await createTestGroup(`Email race ${runId}`)
      const email = await invitationsCaller().create({
        groupId,
        requestId: crypto.randomUUID(),
        email: inviteeEmail,
        role: 'MEMBER',
      })
      const edit = await holdWrite((tx) =>
        tx.groupInvitation.update({
          where: { id: email.invitationId },
          data:
            change === 'revoked'
              ? { status: 'REVOKED' }
              : { email: secondInviteeEmail },
        }),
      )
      const recipient = invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      })
      const accepting = Promise.allSettled([
        operation === 'accept'
          ? recipient.accept({
              invitationId: email.invitationId,
              expectedGroupId: groupId,
            })
          : recipient.decline({ invitationId: email.invitationId }),
      ])
      let waiting = false
      try {
        waiting = await waitForBlockedInviteWrite(edit.pid)
      } finally {
        edit.release()
      }
      await edit.pending
      expect(waiting).toBe(true)
      expect(await accepting).toMatchObject([{ status: 'rejected' }])
      expect(
        await prisma.groupMember.count({
          where: { groupId, accountId: inviteeId },
        }),
      ).toBe(0)
      expect(
        await prisma.activity.count({
          where: {
            subjectId: email.invitationId,
            type: { in: ['INVITATION_ACCEPTED', 'INVITATION_DECLINED'] },
          },
        }),
      ).toBe(0)
      expect(
        await prisma.groupInvitation.findUniqueOrThrow({
          where: { id: email.invitationId },
        }),
      ).toMatchObject(
        change === 'revoked'
          ? { status: 'REVOKED' }
          : { status: 'PENDING', email: secondInviteeEmail },
      )
    },
  )

  it('requires explicit acceptance for each account and never counts preview reads', async () => {
    const { groupId } = await createTestGroup(`Shared landing ${runId}`)
    const link = await invitationsCaller().createSharedLink({
      groupId,
      requestId: crypto.randomUUID(),
      maxUses: 2,
    })
    const token = getInviteToken(link.inviteUrl)!
    for (const [id, email] of [
      [inviteeId, inviteeEmail],
      [secondInviteeId, secondInviteeEmail],
    ] as const) {
      const caller = viewerCaller(id, email)
      expect(
        await caller.get({ groupId, linkInviteToken: token }),
      ).toMatchObject({
        currentMember: null,
      })
      await invitationsCaller({ accountId: id, email }).acceptLink({
        token,
        expectedGroupId: groupId,
      })
      expect(
        await caller.get({ groupId, linkInviteToken: token }),
      ).toMatchObject({
        currentMember: { status: 'ACTIVE' },
      })
    }
    expect(
      await prisma.groupInvitation.findUniqueOrThrow({
        where: { id: link.invitationId },
      }),
    ).toMatchObject({ status: 'PENDING', useCount: 2 })
    await expect(
      viewerCaller(thirdInviteeId, thirdInviteeEmail).get({
        groupId,
        linkInviteToken: token,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('admits only one account racing for the final slot', async () => {
    const { groupId } = await createTestGroup(`Last slot ${runId}`)
    const link = await invitationsCaller().createSharedLink({
      groupId,
      requestId: crypto.randomUUID(),
      maxUses: 2,
    })
    await prisma.groupInvitation.update({
      where: { id: link.invitationId },
      data: { useCount: 1 },
    })
    const results = await Promise.allSettled([
      invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).acceptLink({ token: getInviteToken(link.inviteUrl)! }),
      invitationsCaller({
        accountId: secondInviteeId,
        email: secondInviteeEmail,
      }).acceptLink({ token: getInviteToken(link.inviteUrl)! }),
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      await prisma.groupInvitation.findUniqueOrThrow({
        where: { id: link.invitationId },
      }),
    ).toMatchObject({ useCount: 2 })
    expect(
      await prisma.activity.count({
        where: { subjectId: link.invitationId, type: 'INVITATION_ACCEPTED' },
      }),
    ).toBe(1)
  })

  effectIt.effect(
    'persists email membership and acceptance using the provided Effect clock',
    () =>
      Effect.gen(function* () {
        const { groupId } = yield* Effect.promise(() =>
          createTestGroup(`Email clock ${runId}`),
        )
        const email = yield* Effect.promise(() =>
          invitationsCaller().create({
            groupId,
            requestId: crypto.randomUUID(),
            email: inviteeEmail,
            role: 'MEMBER',
          }),
        )
        const instant = Date.parse('2031-02-03T04:05:06Z')
        yield* TestClock.setTime(instant)
        const member = yield* acceptInvitationEffect({
          invitationId: email.invitationId,
          expectedGroupId: groupId,
          accountId: inviteeId,
          accountEmail: inviteeEmail,
        })
        expect(member.joinedAt).toEqual(new Date(instant))
        const invitation = yield* Effect.promise(() =>
          prisma.groupInvitation.findUniqueOrThrow({
            where: { id: email.invitationId },
          }),
        )
        expect(invitation).toMatchObject({
          status: 'ACCEPTED',
          acceptedById: inviteeId,
          acceptedAt: new Date(instant),
        })
      }).pipe(Effect.provide(InvitationRepository.layer)),
  )

  effectIt.effect(
    'uses Effect clock time at the copy-link expiry boundary',
    () =>
      Effect.gen(function* () {
        const { groupId } = yield* Effect.promise(() =>
          createTestGroup(`Clock expiry ${runId}`),
        )
        const link = yield* Effect.promise(() =>
          invitationsCaller().createSharedLink({
            groupId,
            requestId: crypto.randomUUID(),
          }),
        )
        const deadline = link.expiresAt!.getTime()
        const input = {
          groupId,
          invitationId: link.invitationId,
          accountId: adminId,
        }
        yield* TestClock.setTime(deadline - 1)
        expect((yield* getSharedLinkUrlEffect(input)).inviteUrl).toBe(
          link.inviteUrl,
        )
        yield* TestClock.setTime(deadline)
        const ended = yield* Effect.flip(getSharedLinkUrlEffect(input))
        expect(ended).toMatchObject({
          _tag: 'InviteLinkEndedError',
          reason: 'expired',
        })
      }).pipe(Effect.provide(InvitationRepository.layer)),
  )

  it('counts one rejoin when an account concurrently uses two shared links', async () => {
    const { groupId } = await createTestGroup(`Concurrent rejoin ${runId}`)
    const first = await invitationsCaller().createSharedLink({
      groupId,
      requestId: crypto.randomUUID(),
    })
    const second = await invitationsCaller().createSharedLink({
      groupId,
      requestId: crypto.randomUUID(),
    })
    const invitee = invitationsCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    })
    await invitee.acceptLink({ token: getInviteToken(first.inviteUrl)! })
    await prisma.groupMember.update({
      where: { groupId_accountId: { groupId, accountId: inviteeId } },
      data: { status: 'LEFT' },
    })
    const edit = await holdWrite((tx) =>
      tx.groupMember.update({
        where: { groupId_accountId: { groupId, accountId: inviteeId } },
        data: { leftAt: new Date() },
      }),
    )
    const accepting = Promise.allSettled(
      [first, second].map((link) =>
        invitee.acceptLink({ token: getInviteToken(link.inviteUrl)! }),
      ),
    )
    let waiting = false
    try {
      waiting = await waitForBlockedInviteWrite(edit.pid, 2)
    } finally {
      edit.release()
    }
    await edit.pending
    const results = await accepting
    expect(waiting).toBe(true)
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({
      reason: {
        code: 'BAD_REQUEST',
        message: expect.stringMatching(/already a member/i),
      },
    })
    const usage = await prisma.groupInvitation.aggregate({
      where: { id: { in: [first.invitationId, second.invitationId] } },
      _sum: { useCount: true },
    })
    expect(usage._sum.useCount).toBe(2) // initial join + one actual rejoin
  })

  it.each([
    ['shared', 'REMOVED'],
    ['shared', 'SUSPENDED'],
    ['one-time', 'REMOVED'],
    ['one-time', 'SUSPENDED'],
  ] as const)(
    'a %s link cannot bypass a %s membership restriction',
    async (kind, status) => {
      const { groupId } = await createTestGroup(`Blocked landing ${runId}`)
      const link = await invitationsCaller().createSharedLink({
        groupId,
        requestId: crypto.randomUUID(),
      })
      const token = getInviteToken(link.inviteUrl)!
      await invitationsCaller({
        accountId: inviteeId,
        email: inviteeEmail,
      }).acceptLink({ token })
      await prisma.groupMember.update({
        where: { groupId_accountId: { groupId, accountId: inviteeId } },
        data: { status },
      })
      const redeem =
        kind === 'shared'
          ? link
          : await invitationsCaller().createLink({
              groupId,
              requestId: crypto.randomUUID(),
            })
      const redeemToken = getInviteToken(redeem.inviteUrl)!
      expect(
        await viewerCaller().get({ groupId, linkInviteToken: redeemToken }),
      ).toMatchObject({ currentMember: null })
      await expect(
        invitationsCaller({
          accountId: inviteeId,
          email: inviteeEmail,
        }).acceptLink({ token: redeemToken, expectedGroupId: groupId }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringMatching(/cannot rejoin/i),
      })
      expect(
        await prisma.groupInvitation.findUniqueOrThrow({
          where: { id: link.invitationId },
        }),
      ).toMatchObject({ useCount: 1 })
      expect(
        await prisma.groupMember.findUniqueOrThrow({
          where: { groupId_accountId: { groupId, accountId: inviteeId } },
        }),
      ).toMatchObject({ status })
    },
  )

  effectIt.effect.each(['shared', 'one-time'] as const)(
    '%s joins cannot cross expiry while waiting for a row lock',
    (kind) =>
      Effect.gen(function* () {
        const { groupId } = yield* Effect.promise(() =>
          createTestGroup(`Expiry lock ${runId}`),
        )
        const link = yield* Effect.promise(() =>
          kind === 'shared'
            ? invitationsCaller().createSharedLink({
                groupId,
                requestId: crypto.randomUUID(),
              })
            : invitationsCaller().createLink({
                groupId,
                requestId: crypto.randomUUID(),
              }),
        )
        const deadline = link.expiresAt!.getTime()
        yield* TestClock.setTime(deadline - 1)
        const edit = yield* Effect.promise(() =>
          holdInviteEdit(link.invitationId, { expiresAt: link.expiresAt! }),
        )
        const accepting = yield* Effect.forkChild(
          Effect.flip(
            acceptLinkInvitationEffect({
              accountId: inviteeId,
              token: getInviteToken(link.inviteUrl)!,
            }),
          ),
        )
        let waiting = false
        try {
          waiting = yield* Effect.promise(() =>
            waitForBlockedInviteWrite(edit.pid),
          )
        } finally {
          yield* TestClock.setTime(deadline)
          edit.release()
        }
        yield* Effect.promise(() => edit.pending)
        const ended = yield* Fiber.join(accepting)
        expect(waiting).toBe(true)
        expect(ended).toMatchObject({
          _tag: 'InviteLinkEndedError',
          reason: 'expired',
        })
        expect(
          yield* Effect.promise(() =>
            prisma.groupMember.count({
              where: { groupId, accountId: inviteeId },
            }),
          ),
        ).toBe(0)
        expect(
          yield* Effect.promise(() =>
            prisma.groupInvitation.findUniqueOrThrow({
              where: { id: link.invitationId },
            }),
          ),
        ).toMatchObject({ status: 'PENDING', useCount: 0 })
      }).pipe(
        Effect.provide(
          Layer.mergeAll(InvitationRepository.layer, InviteLiveTokens),
        ),
      ),
  )
})
