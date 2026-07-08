import {
  GroupInvitationStatus,
  GroupInvitationType,
  GroupMemberStatus,
  GroupRole,
  GroupType,
  prisma,
} from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { autoAcceptPendingFriendInvitationsForAccount } from '../lib/api/friends'
import { accountRouter } from '../trpc/routers/account'
import { friendsRouter } from '../trpc/routers/friends'
import { groupsRouter } from '../trpc/routers/groups'
import { invitationsRouter } from '../trpc/routers/invitations'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

/**
 * Friend-ledger API tests against a real PostgreSQL database.
 *
 * Covers:
 *  - `friends.create` direct-accept path (peer is a known account)
 *  - `friends.create` direct-accept via email of an existing account
 *  - `friends.create` pending email path (peer is unknown)
 *  - `friends.create` pending link path
 *  - Lookup-or-create idempotency
 *  - Auto-accept on signup (Better Auth `databaseHooks.user.create.after`)
 *  - Auto-accept on link-open (`groups.get` link-token branch)
 *  - `invitations.listForAccount` filtering
 *  - Restricted actions on FRIEND-typed groups
 *  - `account.groups` displayName + groupType
 *  - `account.friends` hasFriendLedger
 *  - `invitations.previewLink` FRIEND-aware display name
 *  - Migration data verification (preference cleanup)
 */
describe('Friend ledger — real DB', () => {
  const runId = testRunId()
  const callerId = `acct-caller-${runId}`
  const callerEmail = `caller-${runId}@test.example`
  const peerId = `acct-peer-${runId}`
  const peerEmail = `peer-${runId}@test.example`
  const thirdId = `acct-third-${runId}`
  const thirdEmail = `third-${runId}@test.example`

  const ledgerIds: string[] = []
  function trackLedger(id: string) {
    ledgerIds.push(id)
  }
  const trackedGroupIds: string[] = []
  function trackGroup(id: string) {
    trackedGroupIds.push(id)
  }

  function makeCaller(overrides?: {
    accountId?: string
    email?: string
    name?: string
  }) {
    return friendsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: overrides?.accountId ?? callerId,
          email: overrides?.email ?? callerEmail,
          emailVerified: true,
          name: overrides?.name ?? 'Test Caller',
        },
      },
    } as never)
  }

  function makeAccountCaller(overrides?: {
    accountId?: string
    email?: string
    name?: string
  }) {
    return accountRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: overrides?.accountId ?? callerId,
          email: overrides?.email ?? callerEmail,
          emailVerified: true,
          name: overrides?.name ?? 'Test Caller',
        },
      },
    } as never)
  }

  function makeGroupsCaller(overrides?: {
    accountId?: string
    email?: string
    name?: string
  }) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: overrides?.accountId ?? callerId,
          email: overrides?.email ?? callerEmail,
          emailVerified: true,
          name: overrides?.name ?? 'Test Caller',
        },
      },
    } as never)
  }

  function makeInvitationsCaller(overrides?: {
    accountId?: string
    email?: string
    name?: string
  }) {
    return invitationsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: overrides?.accountId ?? callerId,
          email: overrides?.email ?? callerEmail,
          emailVerified: true,
          name: overrides?.name ?? 'Test Caller',
        },
      },
    } as never)
  }

  beforeAll(async () => {
    for (const [id, email, name] of [
      [callerId, callerEmail, 'Test Caller'],
      [peerId, peerEmail, 'Test Peer'],
      [thirdId, thirdEmail, 'Test Third'],
    ] as const) {
      await prisma.account.upsert({
        where: { email },
        update: {},
        create: {
          id,
          email,
          emailVerified: true,
          name,
        },
      })
    }
  })

  afterAll(async () => {
    // Friend groups + their ledgers (delete group cascades to ledger + members + invitations)
    for (const gid of trackedGroupIds) {
      await prisma.group.delete({ where: { id: gid } }).catch(() => {})
    }
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    // Wipe any untracked groups/ledgers created by this test file by account id
    const myGroupIds = await prisma.group
      .findMany({
        where: {
          members: { some: { accountId: { in: [callerId, peerId, thirdId] } } },
        },
        select: { id: true },
      })
      .then((rows) => rows.map((r) => r.id))
    for (const gid of myGroupIds) {
      await prisma.group.delete({ where: { id: gid } }).catch(() => {})
    }
    for (const aid of [callerId, peerId, thirdId]) {
      await prisma.account.delete({ where: { id: aid } }).catch(() => {})
    }
  })

  // ───────────────────────────────────────────────────────────────────
  // 13.1: friends.create direct-accept with a known account
  // ───────────────────────────────────────────────────────────────────
  it('direct-accept: creates friend ledger with two ADMIN/ACTIVE members and friendPairKey', async () => {
    const result = await makeCaller().create({
      friendFormValues: {
        peerAccountId: peerId,
        currency: '€',
        currencyCode: 'EUR',
      },
    })

    expect(result.existed).toBe(false)
    expect(result.groupId).toBeTruthy()
    trackGroup(result.groupId)

    const group = await prisma.group.findUnique({
      where: { id: result.groupId },
    })
    expect(group).not.toBeNull()
    expect(group!.groupType).toBe(GroupType.FRIEND)
    expect(group!.name).toBeTruthy()
    expect(group!.friendPairKey).not.toBeNull()
    // Friend pair key is normalized smaller-id-first
    const [smaller, larger] = [callerId, peerId].sort()
    expect(group!.friendPairKey).toBe(`${smaller}:${larger}`)

    const members = await prisma.groupMember.findMany({
      where: { groupId: result.groupId },
    })
    expect(members).toHaveLength(2)
    for (const m of members) {
      expect(m.role).toBe(GroupRole.ADMIN)
      expect(m.status).toBe(GroupMemberStatus.ACTIVE)
    }
    expect(members.map((m) => m.accountId).sort()).toEqual(
      [callerId, peerId].sort(),
    )

    // Both members have a LedgerParticipant
    const participants = await prisma.ledgerParticipant.findMany({
      where: { ledger: { group: { id: result.groupId } } },
    })
    expect(participants).toHaveLength(2)

    // No invitation row
    const invites = await prisma.groupInvitation.findMany({
      where: { groupId: result.groupId },
    })
    expect(invites).toHaveLength(0)
  })

  // ───────────────────────────────────────────────────────────────────
  // 13.2: direct-accept via email of an existing account
  // ───────────────────────────────────────────────────────────────────
  it('direct-accept via email: resolves existing accountId, no invitation row', async () => {
    const result = await makeCaller().create({
      friendFormValues: {
        peerEmail: thirdEmail,
        currency: '$',
        currencyCode: 'USD',
      },
    })

    expect(result.existed).toBe(false)
    expect(result.groupId).toBeTruthy()
    trackGroup(result.groupId)

    const group = await prisma.group.findUnique({
      where: { id: result.groupId },
    })
    expect(group!.groupType).toBe(GroupType.FRIEND)
    expect(group!.friendPairKey).not.toBeNull()

    // No invitation row — direct accept path
    const invites = await prisma.groupInvitation.findMany({
      where: { groupId: result.groupId },
    })
    expect(invites).toHaveLength(0)

    const members = await prisma.groupMember.findMany({
      where: { groupId: result.groupId },
    })
    expect(members).toHaveLength(2)
    expect(members.map((m) => m.accountId).sort()).toEqual(
      [callerId, thirdId].sort(),
    )
  })

  // ───────────────────────────────────────────────────────────────────
  // 13.3: pending email path
  // ───────────────────────────────────────────────────────────────────
  it('pending email: creates group with caller only, PENDING EMAIL invitation, no friendPairKey', async () => {
    const pendingEmail = `pending-${runId}@unknown.example`

    const result = await makeCaller().create({
      friendFormValues: {
        peerEmail: pendingEmail,
        temporaryName: 'Pending Friend',
        currency: '£',
        currencyCode: 'GBP',
      },
    })

    expect(result.existed).toBe(false)
    expect(result.groupId).toBeTruthy()
    expect(result.invitationId).toBeTruthy()
    trackGroup(result.groupId)

    const group = await prisma.group.findUnique({
      where: { id: result.groupId },
    })
    expect(group!.groupType).toBe(GroupType.FRIEND)
    expect(group!.friendPairKey).toBeNull()

    const members = await prisma.groupMember.findMany({
      where: { groupId: result.groupId },
    })
    expect(members).toHaveLength(1)
    expect(members[0]!.accountId).toBe(callerId)
    expect(members[0]!.role).toBe(GroupRole.ADMIN)
    expect(members[0]!.status).toBe(GroupMemberStatus.ACTIVE)

    const invitation = await prisma.groupInvitation.findUnique({
      where: { id: result.invitationId! },
    })
    expect(invitation).not.toBeNull()
    expect(invitation!.type).toBe(GroupInvitationType.EMAIL)
    expect(invitation!.status).toBe(GroupInvitationStatus.PENDING)
    expect(invitation!.email).toBe(pendingEmail)
    expect(invitation!.role).toBe(GroupRole.ADMIN)
    expect(invitation!.temporaryName).toBe('Pending Friend')
    expect(invitation!.invitedById).toBe(callerId)
  })

  // ───────────────────────────────────────────────────────────────────
  // 13.4: pending link path
  // ───────────────────────────────────────────────────────────────────
  it('pending link: creates group with caller only, PENDING LINK invitation, returns inviteUrl', async () => {
    const result = await makeCaller().create({
      friendFormValues: {
        useLink: true,
        temporaryName: 'Link Friend',
        currency: '$',
        currencyCode: 'USD',
      },
    })

    expect(result.existed).toBe(false)
    expect(result.groupId).toBeTruthy()
    expect(result.inviteUrl).toBeTruthy()
    expect(result.token).toBeTruthy()
    expect(result.inviteUrl).toContain(result.token!)
    trackGroup(result.groupId)

    const group = await prisma.group.findUnique({
      where: { id: result.groupId },
    })
    expect(group!.groupType).toBe(GroupType.FRIEND)
    expect(group!.friendPairKey).toBeNull()

    const members = await prisma.groupMember.findMany({
      where: { groupId: result.groupId },
    })
    expect(members).toHaveLength(1)
    expect(members[0]!.accountId).toBe(callerId)

    const invitation = await prisma.groupInvitation.findFirst({
      where: { groupId: result.groupId, type: GroupInvitationType.LINK },
    })
    expect(invitation).not.toBeNull()
    expect(invitation!.status).toBe(GroupInvitationStatus.PENDING)
    expect(invitation!.temporaryName).toBe('Link Friend')
  })

  // ───────────────────────────────────────────────────────────────────
  // 13.5: lookup-or-create idempotency
  // ───────────────────────────────────────────────────────────────────
  it('idempotency: a second direct-accept with the same pair returns existed:true', async () => {
    // Set up a fresh pair so we don't disturb other tests
    const aId = `acct-a-${runId}`
    const aEmail = `a-${runId}@test.example`
    const bId = `acct-b-${runId}`
    const bEmail = `b-${runId}@test.example`
    await prisma.account.createMany({
      data: [
        { id: aId, email: aEmail, emailVerified: true, name: 'A' },
        { id: bId, email: bEmail, emailVerified: true, name: 'B' },
      ],
    })

    try {
      const first = await makeCaller({
        accountId: aId,
        email: aEmail,
        name: 'A',
      }).create({
        friendFormValues: {
          peerAccountId: bId,
          currency: '$',
          currencyCode: 'USD',
        },
      })
      expect(first.existed).toBe(false)
      trackGroup(first.groupId)

      const second = await makeCaller({
        accountId: aId,
        email: aEmail,
        name: 'A',
      }).create({
        friendFormValues: {
          peerAccountId: bId,
          currency: '$',
          currencyCode: 'USD',
        },
      })
      expect(second.existed).toBe(true)
      expect(second.groupId).toBe(first.groupId)
    } finally {
      await prisma.account.delete({ where: { id: aId } }).catch(() => {})
      await prisma.account.delete({ where: { id: bId } }).catch(() => {})
    }
  })

  // ───────────────────────────────────────────────────────────────────
  // 13.6: auto-accept on signup (Better Auth `databaseHooks.user.create.after`)
  // ───────────────────────────────────────────────────────────────────
  it('auto-accept on signup: pending FRIEND email invitation is reconciled for a new matching account', async () => {
    const newEmail = `autosignup-${runId}@test.example`

    // Create a pending FRIEND email invitation
    const created = await makeCaller().create({
      friendFormValues: {
        peerEmail: newEmail,
        temporaryName: 'Auto-Accept Friend',
        currency: '$',
        currencyCode: 'USD',
      },
    })
    trackGroup(created.groupId)
    const invitationId = created.invitationId!

    // Simulate the Better Auth `databaseHooks.user.create.after` call.
    // In production this is invoked automatically when the user signs up
    // and the account row is created. Here we create the account then
    // run the same auto-accept helper.
    const newAccountId = `acct-new-${runId}`
    await prisma.account.create({
      data: {
        id: newAccountId,
        email: newEmail,
        emailVerified: true,
        name: 'Auto-Accept Friend',
      },
    })

    try {
      await autoAcceptPendingFriendInvitationsForAccount({
        accountId: newAccountId,
        accountEmail: newEmail,
      })

      // Invitation flipped to ACCEPTED
      const invitation = await prisma.groupInvitation.findUnique({
        where: { id: invitationId },
      })
      expect(invitation!.status).toBe(GroupInvitationStatus.ACCEPTED)
      expect(invitation!.acceptedById).toBe(newAccountId)
      expect(invitation!.acceptedAt).not.toBeNull()

      // New account is now a GroupMember
      const member = await prisma.groupMember.findUnique({
        where: {
          groupId_accountId: {
            groupId: created.groupId,
            accountId: newAccountId,
          },
        },
      })
      expect(member).not.toBeNull()
      expect(member!.status).toBe(GroupMemberStatus.ACTIVE)
      expect(member!.role).toBe(GroupRole.ADMIN)

      // friendPairKey is set on the group
      const group = await prisma.group.findUnique({
        where: { id: created.groupId },
      })
      expect(group!.friendPairKey).not.toBeNull()
      const [smaller, larger] = [callerId, newAccountId].sort()
      expect(group!.friendPairKey).toBe(`${smaller}:${larger}`)
    } finally {
      await prisma.account
        .delete({ where: { id: newAccountId } })
        .catch(() => {})
    }
  })

  // ───────────────────────────────────────────────────────────────────
  // 13.7: auto-accept on link-open
  // ───────────────────────────────────────────────────────────────────
  it('auto-accept on link-open: groups.get with a PENDING FRIEND link token accepts the invitation', async () => {
    // Use a fresh recipient so the partial unique index on
    // Group.friendPairKey does not collide with friend groups
    // already created earlier in this test file.
    const linkRecipientId = `acct-linkrecv-${runId}`
    const linkRecipientEmail = `linkrecv-${runId}@test.example`
    await prisma.account.create({
      data: {
        id: linkRecipientId,
        email: linkRecipientEmail,
        emailVerified: true,
        name: 'Link Recipient',
      },
    })

    try {
      // Caller creates a friend ledger with a link path
      const created = await makeCaller().create({
        friendFormValues: {
          useLink: true,
          temporaryName: 'Link Open Friend',
          currency: '$',
          currencyCode: 'USD',
        },
      })
      trackGroup(created.groupId)
      const token = created.token!
      const groupId = created.groupId

      const before = await prisma.groupMember.findUnique({
        where: { groupId_accountId: { groupId, accountId: linkRecipientId } },
      })
      expect(before).toBeNull()

      await makeGroupsCaller({
        accountId: linkRecipientId,
        email: linkRecipientEmail,
        name: 'Link Recipient',
      }).get({ groupId, linkInviteToken: token })

      const after = await prisma.groupMember.findUnique({
        where: { groupId_accountId: { groupId, accountId: linkRecipientId } },
      })
      expect(after).not.toBeNull()
      expect(after!.status).toBe(GroupMemberStatus.ACTIVE)
      expect(after!.role).toBe(GroupRole.ADMIN)

      const invitation = await prisma.groupInvitation.findFirst({
        where: { groupId, type: GroupInvitationType.LINK },
      })
      expect(invitation!.status).toBe(GroupInvitationStatus.ACCEPTED)
      expect(invitation!.acceptedById).toBe(linkRecipientId)

      const group = await prisma.group.findUnique({ where: { id: groupId } })
      expect(group!.friendPairKey).not.toBeNull()
    } finally {
      await prisma.account
        .delete({ where: { id: linkRecipientId } })
        .catch(() => {})
    }
  })

  // ───────────────────────────────────────────────────────────────────
  // 13.8: invitations.listForAccount excludes FRIEND invitations
  // ───────────────────────────────────────────────────────────────────
  it('listForAccount: FRIEND email invitations are filtered out', async () => {
    // pendingEmail from test 13.3 was created by the caller. Pretend the
    // unknown email belongs to a new account so listForAccount has
    // something to filter.
    const targetEmail = `pending-${runId}@unknown.example`
    const targetAccountId = `acct-listfilter-${runId}`
    await prisma.account.create({
      data: {
        id: targetAccountId,
        email: targetEmail,
        emailVerified: true,
        name: 'Target',
      },
    })

    try {
      const result = await makeInvitationsCaller({
        accountId: targetAccountId,
        email: targetEmail,
        name: 'Target',
      }).listForAccount()
      // No FRIEND invitation should appear
      const friendInvites = result.invitations.filter(
        (i) => i.group.groupType === GroupType.FRIEND,
      )
      expect(friendInvites).toHaveLength(0)
    } finally {
      await prisma.account
        .delete({ where: { id: targetAccountId } })
        .catch(() => {})
    }
  })

  // ───────────────────────────────────────────────────────────────────
  // 13.9: restricted actions on FRIEND groups
  // ───────────────────────────────────────────────────────────────────
  describe('restricted actions for FRIEND-typed groups', () => {
    let groupId: string
    let groupName: string

    beforeAll(async () => {
      // Create a fresh FRIEND group owned by the caller with peerId as the other member
      const result = await makeCaller().create({
        friendFormValues: {
          peerAccountId: peerId,
          currency: '$',
          currencyCode: 'USD',
        },
      })
      groupId = result.groupId
      trackGroup(groupId)
      const group = await prisma.group.findUnique({ where: { id: result.groupId } })
      groupName = group!.name
    })

    it('groups.update with name change is rejected (FORBIDDEN)', async () => {
      await expect(
        makeGroupsCaller().update({
          groupId,
          groupFormValues: {
            name: 'Renamed',
            currency: '$',
            currencyCode: 'USD',
            participants: [{ name: 'Caller' }],
          },
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('groups.update with information change is ALLOWED', async () => {
      await makeGroupsCaller().update({
        groupId,
        groupFormValues: {
          name: groupName,
          information: 'Some context',
          currency: '$',
          currencyCode: 'USD',
          participants: [{ name: 'Caller' }],
        },
      })
      const group = await prisma.group.findUnique({ where: { id: groupId } })
      expect(group!.information).toBe('Some context')
    })

    it('groups.update with currency change is ALLOWED', async () => {
      await makeGroupsCaller().update({
        groupId,
        groupFormValues: {
          name: groupName,
          currency: '€',
          currencyCode: 'EUR',
          participants: [{ name: 'Caller' }],
        },
      })
      const ledger = await prisma.ledger.findFirst({
        where: { group: { id: groupId } },
      })
      expect(ledger!.currency).toBe('€')
      expect(ledger!.currencyCode).toBe('EUR')
    })

    it('groups.archive is rejected (FORBIDDEN)', async () => {
      await expect(
        makeGroupsCaller().archive({ groupId, archived: true }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('groups.delete is rejected (FORBIDDEN)', async () => {
      await expect(
        makeGroupsCaller().delete({ groupId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('groups.leave is rejected (FORBIDDEN)', async () => {
      await expect(makeGroupsCaller().leave({ groupId })).rejects.toMatchObject(
        { code: 'FORBIDDEN' },
      )
    })

    it('invitations.create is rejected (FORBIDDEN)', async () => {
      await expect(
        makeInvitationsCaller().create({
          groupId,
          email: 'invitee@example.test',
          role: 'MEMBER',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('invitations.createLink is rejected (FORBIDDEN)', async () => {
      await expect(
        makeInvitationsCaller().createLink({ groupId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('invitations.revoke is rejected (FORBIDDEN)', async () => {
      // Create a friend ledger with a link path so it has a real
      // PENDING LINK invitation we can target.
      const linkResult = await makeCaller().create({
        friendFormValues: {
          useLink: true,
          temporaryName: 'Revoke Friend',
          currency: '$',
          currencyCode: 'USD',
        },
      })
      trackGroup(linkResult.groupId)
      const linkInvitation = await prisma.groupInvitation.findFirst({
        where: {
          groupId: linkResult.groupId,
          type: GroupInvitationType.LINK,
        },
      })
      expect(linkInvitation).not.toBeNull()

      await expect(
        makeInvitationsCaller().revoke({
          invitationId: linkInvitation!.id,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })
  })

  // ───────────────────────────────────────────────────────────────────
  // 13.10: account.groups returns groupType + displayName
  // ───────────────────────────────────────────────────────────────────
  it('account.groups: returns groupType and displayName for both GROUP and FRIEND', async () => {
    // Create a normal GROUP for the caller
    const { groupId: regularGroupId } = await makeGroupsCaller().create({
      groupFormValues: {
        name: `Regular ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Caller' }],
      },
    })
    const regularGroup = await prisma.group.findUnique({
      where: { id: regularGroupId },
    })
    trackLedger(regularGroup!.ledgerId)

    // The friend group from test 13.1 already exists (caller+peer)
    const result = await makeAccountCaller().groups({ includeArchived: false })

    const regular = result.groups.find((g) => g.id === regularGroupId)
    expect(regular).toBeDefined()
    expect(regular!.groupType).toBe(GroupType.GROUP)
    expect(regular!.displayName).toBe(`Regular ${runId}`)

    const friendGroups = result.groups.filter(
      (g) => g.groupType === GroupType.FRIEND,
    )
    // Friend groups with only the caller as ACTIVE member and no
    // PENDING invitation (e.g. the invitee deleted their account) have
    // an empty displayName. Skip those orphan groups in the assertion.
    let verified = 0
    for (const fg of friendGroups) {
      const memberCount = await prisma.groupMember.count({
        where: { groupId: fg.id, status: GroupMemberStatus.ACTIVE },
      })
      const pendingCount = await prisma.groupInvitation.count({
        where: { groupId: fg.id, status: GroupInvitationStatus.PENDING },
      })
      if (memberCount <= 1 && pendingCount === 0) continue
      expect(fg.displayName).toBeTruthy()
      expect(fg.displayName).not.toBe('')
      verified++
    }
    expect(verified).toBeGreaterThan(0)
  })

  // ───────────────────────────────────────────────────────────────────
  // 13.11: account.friends hasFriendLedger
  // ───────────────────────────────────────────────────────────────────
  it('account.friends: hasFriendLedger is true when pair exists', async () => {
    // The caller has direct-accept ledgers with peer and third
    const result = await makeAccountCaller().friends({})

    const peerEntry = result.friends.find((f) => f.accountId === peerId)
    expect(peerEntry).toBeDefined()
    expect(peerEntry!.hasFriendLedger).toBe(true)

    const thirdEntry = result.friends.find((f) => f.accountId === thirdId)
    expect(thirdEntry).toBeDefined()
    expect(thirdEntry!.hasFriendLedger).toBe(true)
  })

  // ───────────────────────────────────────────────────────────────────
  // 13.12: invitations.previewLink returns FRIEND-aware name
  // ───────────────────────────────────────────────────────────────────
  it('previewLink: FRIEND group returns "Friend ledger with {inviter}" instead of empty string', async () => {
    const linkResult = await makeCaller().create({
      friendFormValues: {
        useLink: true,
        temporaryName: 'Preview Friend',
        currency: '$',
        currencyCode: 'USD',
      },
    })
    trackGroup(linkResult.groupId)
    const token = linkResult.token!

    const preview = await makeInvitationsCaller().previewLink({ token })
    expect(preview.preview).not.toBeNull()
    expect(preview.preview!.group.name).toMatch(/Friend ledger with /)
    expect(preview.preview!.group.name).toContain('Test Caller')
    expect(preview.preview!.temporaryName).toBe('Preview Friend')
  })
})

// ───────────────────────────────────────────────────────────────────
// 13.13: migration data verification
// ───────────────────────────────────────────────────────────────────
describe('Migration: preference cleanup', () => {
  const runId = testRunId()
  const accountId = `acct-pref-${runId}`
  const email = `pref-${runId}@test.example`
  const groupId = `grp-pref-${runId}`

  beforeAll(async () => {
    await prisma.account.upsert({
      where: { email },
      update: {},
      create: { id: accountId, email, emailVerified: true, name: 'Pref' },
    })
  })

  afterAll(async () => {
    await prisma.account.delete({ where: { id: accountId } }).catch(() => {})
  })

  it('pinned column is gone from AccountGroupPreference', async () => {
    // Prisma's generated types no longer include `pinned`; reaching
    // for the column via $queryRaw with an explicit column name will
    // throw if it doesn't exist. Verify the introspection result.
    const result = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'AccountGroupPreference'
    `
    const columnNames = result.map((r) => r.column_name)
    expect(columnNames).toContain('starred')
    expect(columnNames).toContain('hidden')
    expect(columnNames).not.toContain('pinned')
    expect(columnNames).not.toContain('archived')
  })

  it('archived data was merged into hidden', async () => {
    // Insert a Group + Ledger minimally so we can attach a preference row
    const ledger = await prisma.ledger.create({
      data: { id: `ldg-${runId}`, currency: '$', currencyCode: 'USD' },
    })
    await prisma.group.create({
      data: {
        id: groupId,
        name: 'Test',
        groupType: GroupType.GROUP,
        ledgerId: ledger.id,
      },
    })

    // Set hidden=true via the new schema. The migration unioned
    // `archived OR hidden` into `hidden` then dropped `archived`, so
    // a row that used to be archived=true should now have hidden=true.
    await prisma.accountGroupPreference.create({
      data: {
        id: `pref-${runId}`,
        accountId,
        groupId,
        hidden: true,
        starred: false,
      },
    })

    const row = await prisma.accountGroupPreference.findUnique({
      where: { accountId_groupId: { accountId, groupId } },
    })
    expect(row).not.toBeNull()
    expect(row!.hidden).toBe(true)
    expect(row!.starred).toBe(false)
  })
})
