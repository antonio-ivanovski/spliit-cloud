import { prisma, GroupMemberStatus, GroupRole } from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { groupsRouter } from '../trpc/routers/groups'
import { invitationsRouter } from '../trpc/routers/invitations'
import { checkDbConnection, testRunId } from './setup'
import {
  setDefaultActivityNotificationDispatchers,
  type ActivityNotificationDispatcher,
  type ActivityNotificationEvent,
} from '../lib/notifications/dispatcher'

await checkDbConnection()

class CapturingDispatcher implements ActivityNotificationDispatcher {
  events: ActivityNotificationEvent[] = []
  async dispatch(event: ActivityNotificationEvent): Promise<void> {
    this.events.push(event)
  }
}

describe('Group activity — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-ga-a-${runId}`
  const adminEmail = `ga-a-${runId}@test.example`
  const memberId = `acct-ga-m-${runId}`
  const memberEmail = `ga-m-${runId}@test.example`
  const inviteeId = `acct-ga-i-${runId}`
  const inviteeEmail = `ga-i-${runId}@test.example`

  const ledgerIds: string[] = []
  function trackLedger(id: string) {
    ledgerIds.push(id)
  }

  let groupId: string
  let adminAccountId: string
  let memberParticipantId: string

  function makeCaller(overrides?: { accountId?: string; email?: string }) {
    return groupsRouter.createCaller({
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

  function makeInvitationCaller(
    overrides?: { accountId?: string; email?: string },
  ) {
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
      where: { email: memberEmail },
      update: {},
      create: {
        id: memberId,
        email: memberEmail,
        emailVerified: true,
        name: 'Test Member',
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

    const caller = makeCaller()
    const result = await caller.create({
      groupFormValues: {
        name: `Group Activity ${runId}`,
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
    adminAccountId = group!.members[0].accountId
    const adminLp = group!.members[0].ledgerParticipant!

    // Add a second active member via DB
    const gmId = `gm-ga-m-${runId}`
    memberParticipantId = `lp-ga-m-${runId}`
    await prisma.groupMember.create({
      data: {
        id: gmId,
        groupId,
        accountId: memberId,
        role: GroupRole.MEMBER,
        status: GroupMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
    })
    await prisma.ledgerParticipant.create({
      data: {
        id: memberParticipantId,
        ledgerId: group!.ledger.id,
        groupMemberId: gmId,
      },
    })
  })

  afterAll(async () => {
    setDefaultActivityNotificationDispatchers([])
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
    await prisma.account.delete({ where: { id: memberId } }).catch(() => {})
    await prisma.account.delete({ where: { id: inviteeId } }).catch(() => {})
  })

  // ------------------------------------------------------------------------
  // 1. Group settings update
  // ------------------------------------------------------------------------
  it('logs GROUP_UPDATED and does NOT dispatch', async () => {
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const caller = makeCaller()
    await caller.update({
      groupId,
      groupFormValues: {
        name: `Renamed ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })

    const activity = await prisma.activity.findFirst({
      where: { ledger: { group: { id: groupId } }, type: 'GROUP_UPDATED' },
      orderBy: { time: 'desc' },
    })
    expect(activity).not.toBeNull()
    expect(activity!.actorType).toBe('ACCOUNT')
    expect(activity!.actorId).toBe(adminId)
    expect(activity!.subjectType).toBe('GROUP')
    expect(activity!.subjectId).toBe(groupId)

    const data = activity!.data as Record<string, unknown>
    expect(data.kind).toBe('group')
    expect(data.changedFields).toEqual(expect.arrayContaining(['name']))

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(capture.events).toHaveLength(0)
  })

  // ------------------------------------------------------------------------
  // 2. Group archive
  // ------------------------------------------------------------------------
  it('logs GROUP_ARCHIVED and does NOT dispatch', async () => {
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const caller = makeCaller()
    await caller.archive({ groupId, archived: true, force: true })

    const activity = await prisma.activity.findFirst({
      where: { ledger: { group: { id: groupId } }, type: 'GROUP_ARCHIVED' },
      orderBy: { time: 'desc' },
    })
    expect(activity).not.toBeNull()
    expect(activity!.actorType).toBe('ACCOUNT')
    expect(activity!.actorId).toBe(adminId)

    const data = activity!.data as Record<string, unknown>
    expect(data.kind).toBe('group')

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(capture.events).toHaveLength(0)
  })

  // Unarchive before next tests
  it('unarchives the group', async () => {
    const caller = makeCaller()
    await caller.archive({ groupId, archived: false })
    const activity = await prisma.activity.findFirst({
      where: { ledger: { group: { id: groupId } }, type: 'GROUP_UNARCHIVED' },
      orderBy: { time: 'desc' },
    })
    expect(activity).not.toBeNull()
    expect(activity!.subjectType).toBe('GROUP')
    expect(activity!.subjectId).toBe(groupId)
  })

  // ------------------------------------------------------------------------
  // 3. Member role change
  // ------------------------------------------------------------------------
  it('logs MEMBER_ROLE_CHANGED and does NOT dispatch', async () => {
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const gm = await prisma.groupMember.findFirst({
      where: { groupId, accountId: memberId },
    })
    expect(gm).not.toBeNull()

    const caller = makeCaller()
    await caller.members.updateRole({
      groupId,
      memberId: gm!.id,
      role: 'ADMIN',
    })

    const activity = await prisma.activity.findFirst({
      where: { ledger: { group: { id: groupId } }, type: 'MEMBER_ROLE_CHANGED' },
      orderBy: { time: 'desc' },
    })
    expect(activity).not.toBeNull()
    expect(activity!.actorType).toBe('ACCOUNT')
    expect(activity!.actorId).toBe(adminId)
    expect(activity!.subjectType).toBe('MEMBER')
    expect(activity!.subjectId).toBe(gm!.id)

    const data = activity!.data as Record<string, unknown>
    expect(data.kind).toBe('member')
    expect(data.previousRole).toBe('MEMBER')
    expect(data.nextRole).toBe('ADMIN')

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(capture.events).toHaveLength(0)

    // Demote back for subsequent tests
    await caller.members.updateRole({
      groupId,
      memberId: gm!.id,
      role: 'MEMBER',
    })
  })

  // ------------------------------------------------------------------------
  // 4. Member removed
  // ------------------------------------------------------------------------
  it('logs MEMBER_REMOVED and does NOT dispatch', async () => {
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const gm = await prisma.groupMember.findFirst({
      where: { groupId, accountId: memberId },
    })
    expect(gm).not.toBeNull()

    const caller = makeCaller()
    await caller.members.remove({
      groupId,
      memberId: gm!.id,
      settleBalances: false,
    })

    const activity = await prisma.activity.findFirst({
      where: { ledger: { group: { id: groupId } }, type: 'MEMBER_REMOVED' },
      orderBy: { time: 'desc' },
    })
    expect(activity).not.toBeNull()
    expect(activity!.actorType).toBe('ACCOUNT')
    expect(activity!.actorId).toBe(adminId)

    const data = activity!.data as Record<string, unknown>
    expect(data.kind).toBe('member')
    expect(data.displayName).toBe('Test Admin')
    expect(data.targetDisplayName).toBe('Test Member')

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(capture.events).toHaveLength(0)

    // Re-activate the member for remaining tests
    await prisma.groupMember.update({
      where: { groupId_accountId: { groupId, accountId: memberId } },
      data: {
        status: GroupMemberStatus.ACTIVE,
        leftAt: null,
      },
    })
  })

  // ------------------------------------------------------------------------
  // 5. Member leaves
  // ------------------------------------------------------------------------
  it('logs MEMBER_LEFT and does NOT dispatch', async () => {
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const memberCaller = makeCaller({
      accountId: memberId,
      email: memberEmail,
    })
    await memberCaller.leave({
      groupId,
      force: true,
    })

    const activity = await prisma.activity.findFirst({
      where: { ledger: { group: { id: groupId } }, type: 'MEMBER_LEFT' },
      orderBy: { time: 'desc' },
    })
    expect(activity).not.toBeNull()
    expect(activity!.actorType).toBe('ACCOUNT')
    expect(activity!.actorId).toBe(memberId)

    const data = activity!.data as Record<string, unknown>
    expect(data.kind).toBe('member')
    expect(data.displayName).toBe('Test Member')
    expect(data.targetDisplayName).toBe('Test Member')

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(capture.events).toHaveLength(0)
  })

  // ------------------------------------------------------------------------
  // 6. Invitation create + revoke
  // ------------------------------------------------------------------------
  it('logs INVITATION_CREATED, INVITATION_REVOKED and does NOT dispatch', async () => {
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const invCaller = makeInvitationCaller()
    const { invitationId } = await invCaller.create({
      groupId,
      email: 'new-invitee@test.example',
      role: 'MEMBER',
    })
    expect(invitationId).toBeDefined()

    // Check invitation created activity
    const created = await prisma.activity.findFirst({
      where: {
        ledger: { group: { id: groupId } },
        type: 'INVITATION_CREATED',
        subjectId: invitationId,
      },
    })
    expect(created).not.toBeNull()
    expect(created!.actorId).toBe(adminId)
    expect(created!.subjectType).toBe('INVITATION')
    const createdData = created!.data as Record<string, unknown>
    expect(createdData.kind).toBe('invitation')
    expect(createdData.invitationType).toBe('EMAIL')

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(capture.events).toHaveLength(0)

    // Revoke the invitation
    await invCaller.revoke({ invitationId, settleBalances: false })

    const revoked = await prisma.activity.findFirst({
      where: {
        ledger: { group: { id: groupId } },
        type: 'INVITATION_REVOKED',
        subjectId: invitationId,
      },
    })
    expect(revoked).not.toBeNull()
    expect(revoked!.actorType).toBe('ACCOUNT')
    expect(revoked!.actorId).toBe(adminId)
    const revokedData = revoked!.data as Record<string, unknown>
    expect(revokedData.kind).toBe('invitation')

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(capture.events).toHaveLength(0)
  })

  // ------------------------------------------------------------------------
  // 7. Invitation accept
  // ------------------------------------------------------------------------
  it('logs INVITATION_ACCEPTED and does NOT dispatch', async () => {
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const invCaller = makeInvitationCaller()
    const { invitationId } = await invCaller.create({
      groupId,
      email: inviteeEmail,
      role: 'MEMBER',
    })

    // Accept as the invitee
    const inviteeCaller = makeInvitationCaller({
      accountId: inviteeId,
      email: inviteeEmail,
    })
    await inviteeCaller.accept({ invitationId })

    const accepted = await prisma.activity.findFirst({
      where: {
        ledger: { group: { id: groupId } },
        type: 'INVITATION_ACCEPTED',
        subjectId: invitationId,
      },
    })
    expect(accepted).not.toBeNull()
    expect(accepted!.actorType).toBe('ACCOUNT')
    expect(accepted!.actorId).toBe(inviteeId)
    const acceptedData = accepted!.data as Record<string, unknown>
    expect(acceptedData.kind).toBe('invitation')

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(capture.events).toHaveLength(0)
  })
})
