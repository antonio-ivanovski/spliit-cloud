import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GroupMemberStatus, GroupRole, prisma } from '@spliit/db'

import {
  setDefaultActivityNotificationDispatchers,
  waitForScheduledNotificationDispatchesForTest,
} from '../lib/notifications/dispatcher'
import { groupsRouter } from '../trpc/routers/groups'
import { invitationsRouter } from '../trpc/routers/invitations'
import { CapturingDispatcher, checkDbConnection, testRunId } from './setup'

await checkDbConnection()

function eventsForGroup(capture: CapturingDispatcher, groupId: string) {
  return capture.events.filter((event) => event.groupId === groupId)
}

// --------------------------------------------------------------------------
// Per-test fixture helpers
// --------------------------------------------------------------------------
interface GroupActivityFixture {
  adminId: string
  adminEmail: string
  groupId: string
  ledgerId: string
  adminParticipantId: string
  memberId?: string
  memberEmail?: string
  memberParticipantId?: string
  inviteeId?: string
  inviteeEmail?: string
  cleanup: () => Promise<void>
}

async function createGroupActivityFixture(
  opts: {
    withMember?: boolean
    withInvitee?: boolean
  } = {},
): Promise<GroupActivityFixture> {
  const runId = testRunId()
  const adminId = `acct-ga-${runId}`
  const adminEmail = `ga-${runId}@test.example`

  const accountIdsToClean = [adminId]

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

  // Create group via the caller (admin is auto-added as a member + participant)
  const adminCaller = groupsRouter.createCaller({
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

  const result = await adminCaller.create({
    groupFormValues: {
      name: `Group Activity ${runId}`,
      currency: '$',
      currencyCode: 'USD',
      participants: [{ name: 'Admin' }],
    },
  })

  const group = await prisma.group.findUnique({
    where: { id: result.groupId },
    include: {
      ledger: true,
      members: { include: { ledgerParticipant: true } },
    },
  })
  const ledgerId = group!.ledger.id
  const adminParticipantId = group!.members[0].ledgerParticipant!.id

  let memberId: string | undefined
  let memberEmail: string | undefined
  let memberParticipantId: string | undefined

  if (opts.withMember) {
    memberId = `acct-ga-m-${runId}`
    memberEmail = `ga-m-${runId}@test.example`
    accountIdsToClean.push(memberId)

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

    const gmId = `gm-ga-m-${runId}`
    memberParticipantId = `lp-ga-m-${runId}`
    await prisma.groupMember.create({
      data: {
        id: gmId,
        groupId: result.groupId,
        accountId: memberId,
        role: GroupRole.MEMBER,
        status: GroupMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
    })
    await prisma.ledgerParticipant.create({
      data: {
        id: memberParticipantId,
        ledgerId,
        groupMemberId: gmId,
      },
    })
  }

  let inviteeId: string | undefined
  let inviteeEmail: string | undefined

  if (opts.withInvitee) {
    inviteeId = `acct-ga-i-${runId}`
    inviteeEmail = `ga-i-${runId}@test.example`
    accountIdsToClean.push(inviteeId)

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
  }

  return {
    adminId,
    adminEmail,
    groupId: result.groupId,
    ledgerId,
    adminParticipantId,
    memberId,
    memberEmail,
    memberParticipantId,
    inviteeId,
    inviteeEmail,
    cleanup: async () => {
      // Ledger cascade deletes associated expenses, activities, participants
      await prisma.ledger.delete({ where: { id: ledgerId } }).catch(() => {})
      for (const id of accountIdsToClean) {
        await prisma.account.delete({ where: { id } }).catch(() => {})
      }
    },
  }
}

function makeCaller(
  fixture: { adminId: string; adminEmail: string },
  overrides?: { accountId?: string; email?: string },
) {
  return groupsRouter.createCaller({
    auth: {
      session: { id: 'sess-test' },
      user: {
        id: overrides?.accountId ?? fixture.adminId,
        email: overrides?.email ?? fixture.adminEmail,
        emailVerified: true,
        name:
          overrides?.accountId && overrides.accountId !== fixture.adminId
            ? 'Test Member'
            : 'Test Admin',
      },
    },
  } as never)
}

function makeInvitationCaller(
  fixture: { adminId: string; adminEmail: string },
  overrides?: { accountId?: string; email?: string },
) {
  return invitationsRouter.createCaller({
    auth: {
      session: { id: 'sess-test' },
      user: {
        id: overrides?.accountId ?? fixture.adminId,
        email: overrides?.email ?? fixture.adminEmail,
        emailVerified: true,
        name:
          overrides?.accountId && overrides.accountId !== fixture.adminId
            ? 'Test Member'
            : 'Test Admin',
      },
    },
  } as never)
}

describe('Group activity — real DB', () => {
  let fixture: GroupActivityFixture | undefined

  beforeEach(async () => {
    await waitForScheduledNotificationDispatchesForTest()
    setDefaultActivityNotificationDispatchers([])
    fixture = undefined
  })

  afterEach(async () => {
    try {
      await waitForScheduledNotificationDispatchesForTest()
    } finally {
      setDefaultActivityNotificationDispatchers([])
      if (fixture) {
        await fixture.cleanup()
        fixture = undefined
      }
    }
  })

  // ------------------------------------------------------------------------
  // 1. Group settings update
  // ------------------------------------------------------------------------
  it('logs GROUP_UPDATED and does NOT dispatch', async () => {
    fixture = await createGroupActivityFixture()
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const caller = makeCaller(fixture)
    await caller.update({
      groupId: fixture.groupId,
      groupFormValues: {
        name: `Renamed ${testRunId()}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })

    const activity = await prisma.activity.findFirst({
      where: {
        ledger: { group: { id: fixture.groupId } },
        type: 'GROUP_UPDATED',
      },
      orderBy: { time: 'desc' },
    })
    expect(activity).not.toBeNull()
    expect(activity!.actorType).toBe('ACCOUNT')
    expect(activity!.actorId).toBe(fixture.adminId)
    expect(activity!.subjectType).toBe('GROUP')
    expect(activity!.subjectId).toBe(fixture.groupId)

    const data = activity!.data as Record<string, unknown>
    expect(data.kind).toBe('group')
    expect(data.changedFields).toEqual(expect.arrayContaining(['name']))

    await waitForScheduledNotificationDispatchesForTest()
    expect(eventsForGroup(capture, fixture.groupId)).toHaveLength(0)
  })

  // ------------------------------------------------------------------------
  // 2. Group archive — no unsettled balances, no force, no dispatch
  // ------------------------------------------------------------------------
  it('logs GROUP_ARCHIVED and does NOT dispatch when no unsettled balances', async () => {
    fixture = await createGroupActivityFixture()
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const caller = makeCaller(fixture)
    // Non-force archive succeeds because there are no unsettled balances
    await caller.archive({ groupId: fixture.groupId, archived: true })

    const activity = await prisma.activity.findFirst({
      where: {
        ledger: { group: { id: fixture.groupId } },
        type: 'GROUP_ARCHIVED',
      },
      orderBy: { time: 'desc' },
    })
    expect(activity).not.toBeNull()
    expect(activity!.actorType).toBe('ACCOUNT')
    expect(activity!.actorId).toBe(fixture.adminId)

    const data = activity!.data as Record<string, unknown>
    expect(data.kind).toBe('group')

    await waitForScheduledNotificationDispatchesForTest()
    expect(eventsForGroup(capture, fixture.groupId)).toHaveLength(0)
  })

  // ------------------------------------------------------------------------
  // 3. Force archive with unsettled balances — dispatches settlement notifications
  // ------------------------------------------------------------------------
  it('force archive with unsettled balances dispatches EXPENSE_CREATED notifications', async () => {
    fixture = await createGroupActivityFixture({ withMember: true })
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const caller = makeCaller(fixture)

    // Create an expense where admin paid for both → member owes admin $20
    await caller.expenses.create({
      groupId: fixture.groupId,
      expense: {
        title: 'Dinner',
        amount: 4000,
        paidByList: [{ participant: fixture.adminParticipantId, shares: 4000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: true,
        paidFor: [
          { participant: fixture.adminParticipantId, shares: 1 },
          { participant: fixture.memberParticipantId!, shares: 1 },
        ],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    // Flush any dispatches from the expense creation, then reset capture
    await waitForScheduledNotificationDispatchesForTest()
    capture.events = []

    // Force archive — this should create settlement expenses and dispatch
    await caller.archive({
      groupId: fixture.groupId,
      archived: true,
      force: true,
    })

    // Assert GROUP_ARCHIVED activity was logged
    const archivedActivity = await prisma.activity.findFirst({
      where: {
        ledger: { group: { id: fixture.groupId } },
        type: 'GROUP_ARCHIVED',
      },
      orderBy: { time: 'desc' },
    })
    expect(archivedActivity).not.toBeNull()

    // Assert settlement EXPENSE_CREATED dispatches
    await waitForScheduledNotificationDispatchesForTest()
    const settlementEvents = eventsForGroup(capture, fixture.groupId).filter(
      (event) => event.type === 'EXPENSE_CREATED',
    )
    expect(settlementEvents.length).toBeGreaterThanOrEqual(1)
    expect(settlementEvents[0].groupId).toBe(fixture.groupId)
  })

  // ------------------------------------------------------------------------
  // 4. Member role change
  // ------------------------------------------------------------------------
  it('logs MEMBER_ROLE_CHANGED and does NOT dispatch', async () => {
    fixture = await createGroupActivityFixture({ withMember: true })
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const gm = await prisma.groupMember.findFirst({
      where: { groupId: fixture.groupId, accountId: fixture.memberId! },
    })
    expect(gm).not.toBeNull()

    const caller = makeCaller(fixture)
    await caller.members.updateRole({
      groupId: fixture.groupId,
      memberId: gm!.id,
      role: 'ADMIN',
    })

    const activity = await prisma.activity.findFirst({
      where: {
        ledger: { group: { id: fixture.groupId } },
        type: 'MEMBER_ROLE_CHANGED',
      },
      orderBy: { time: 'desc' },
    })
    expect(activity).not.toBeNull()
    expect(activity!.actorType).toBe('ACCOUNT')
    expect(activity!.actorId).toBe(fixture.adminId)
    expect(activity!.subjectType).toBe('MEMBER')
    expect(activity!.subjectId).toBe(gm!.id)

    const data = activity!.data as Record<string, unknown>
    expect(data.kind).toBe('member')
    expect(data.previousRole).toBe('MEMBER')
    expect(data.nextRole).toBe('ADMIN')

    await waitForScheduledNotificationDispatchesForTest()
    expect(eventsForGroup(capture, fixture.groupId)).toHaveLength(0)
  })

  // ------------------------------------------------------------------------
  // 5. Member removed
  // ------------------------------------------------------------------------
  it('logs MEMBER_REMOVED and does NOT dispatch', async () => {
    fixture = await createGroupActivityFixture({ withMember: true })
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const gm = await prisma.groupMember.findFirst({
      where: { groupId: fixture.groupId, accountId: fixture.memberId! },
    })
    expect(gm).not.toBeNull()

    const caller = makeCaller(fixture)
    await caller.members.remove({
      groupId: fixture.groupId,
      memberId: gm!.id,
      settleBalances: false,
    })

    const activity = await prisma.activity.findFirst({
      where: {
        ledger: { group: { id: fixture.groupId } },
        type: 'MEMBER_REMOVED',
      },
      orderBy: { time: 'desc' },
    })
    expect(activity).not.toBeNull()
    expect(activity!.actorType).toBe('ACCOUNT')
    expect(activity!.actorId).toBe(fixture.adminId)

    const data = activity!.data as Record<string, unknown>
    expect(data.kind).toBe('member')
    expect(data.displayName).toBe('Test Admin')
    expect(data.targetDisplayName).toBe('Test Member')

    await waitForScheduledNotificationDispatchesForTest()
    expect(eventsForGroup(capture, fixture.groupId)).toHaveLength(0)
  })

  // ------------------------------------------------------------------------
  // 6. Member leaves
  // ------------------------------------------------------------------------
  it('logs MEMBER_LEFT and does NOT dispatch', async () => {
    fixture = await createGroupActivityFixture({ withMember: true })
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const memberCaller = makeCaller(fixture, {
      accountId: fixture.memberId!,
      email: fixture.memberEmail!,
    })
    // No unsettled balances — force is not needed
    await memberCaller.leave({
      groupId: fixture.groupId,
    })

    const activity = await prisma.activity.findFirst({
      where: {
        ledger: { group: { id: fixture.groupId } },
        type: 'MEMBER_LEFT',
      },
      orderBy: { time: 'desc' },
    })
    expect(activity).not.toBeNull()
    expect(activity!.actorType).toBe('ACCOUNT')
    expect(activity!.actorId).toBe(fixture.memberId)

    const data = activity!.data as Record<string, unknown>
    expect(data.kind).toBe('member')
    expect(data.displayName).toBe('Test Member')
    expect(data.targetDisplayName).toBe('Test Member')

    await waitForScheduledNotificationDispatchesForTest()
    expect(eventsForGroup(capture, fixture.groupId)).toHaveLength(0)
  })

  // ------------------------------------------------------------------------
  // 7. Invitation create + revoke
  // ------------------------------------------------------------------------
  it('logs INVITATION_CREATED, INVITATION_REVOKED and does NOT dispatch', async () => {
    fixture = await createGroupActivityFixture()
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const invCaller = makeInvitationCaller(fixture)
    const { invitationId } = await invCaller.create({
      groupId: fixture.groupId,
      email: `new-invitee-${fixture.groupId}@test.example`,
      role: 'MEMBER',
    })
    expect(invitationId).toBeDefined()

    // Check invitation created activity
    const created = await prisma.activity.findFirst({
      where: {
        ledger: { group: { id: fixture.groupId } },
        type: 'INVITATION_CREATED',
        subjectId: invitationId,
      },
    })
    expect(created).not.toBeNull()
    expect(created!.actorId).toBe(fixture.adminId)
    expect(created!.subjectType).toBe('INVITATION')
    const createdData = created!.data as Record<string, unknown>
    expect(createdData.kind).toBe('invitation')
    expect(createdData.invitationType).toBe('EMAIL')

    await waitForScheduledNotificationDispatchesForTest()
    expect(eventsForGroup(capture, fixture.groupId)).toHaveLength(0)

    // Revoke the invitation
    await invCaller.revoke({ invitationId, settleBalances: false })

    const revoked = await prisma.activity.findFirst({
      where: {
        ledger: { group: { id: fixture.groupId } },
        type: 'INVITATION_REVOKED',
        subjectId: invitationId,
      },
    })
    expect(revoked).not.toBeNull()
    expect(revoked!.actorType).toBe('ACCOUNT')
    expect(revoked!.actorId).toBe(fixture.adminId)
    const revokedData = revoked!.data as Record<string, unknown>
    expect(revokedData.kind).toBe('invitation')

    await waitForScheduledNotificationDispatchesForTest()
    expect(eventsForGroup(capture, fixture.groupId)).toHaveLength(0)
  })

  // ------------------------------------------------------------------------
  // 8. Invitation accept
  // ------------------------------------------------------------------------
  it('logs INVITATION_ACCEPTED and does NOT dispatch', async () => {
    fixture = await createGroupActivityFixture({ withInvitee: true })
    const capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const invCaller = makeInvitationCaller(fixture)
    const { invitationId } = await invCaller.create({
      groupId: fixture.groupId,
      email: fixture.inviteeEmail!,
      role: 'MEMBER',
    })

    // Accept as the invitee
    const inviteeCaller = makeInvitationCaller(fixture, {
      accountId: fixture.inviteeId!,
      email: fixture.inviteeEmail!,
    })
    await inviteeCaller.accept({ invitationId })

    const accepted = await prisma.activity.findFirst({
      where: {
        ledger: { group: { id: fixture.groupId } },
        type: 'INVITATION_ACCEPTED',
        subjectId: invitationId,
      },
    })
    expect(accepted).not.toBeNull()
    expect(accepted!.actorType).toBe('ACCOUNT')
    expect(accepted!.actorId).toBe(fixture.inviteeId)
    const acceptedData = accepted!.data as Record<string, unknown>
    expect(acceptedData.kind).toBe('invitation')

    await waitForScheduledNotificationDispatchesForTest()
    // The setup invites an existing account, so `INVITATION_CREATED`
    // legitimately dispatches to the invitee in production. Assert only on
    // the activity under test.
    expect(
      eventsForGroup(capture, fixture.groupId).filter(
        (event) => event.type === 'INVITATION_ACCEPTED',
      ),
    ).toHaveLength(0)
  })
})
