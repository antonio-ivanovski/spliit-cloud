import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { GroupMemberStatus, GroupRole, prisma } from '@spliit/db'

import { getGroupBalances, hasUnsettledBalances } from '../lib/api/balances'
import { updateMemberRole } from '../lib/api/members'
import { participantDisplayNameSelect } from '../lib/api/selects/participant-display-name'
import {
  cancelAccountDeletion,
  executeAccountDeletion,
  getDeletionPreview,
  requestAccountDeletion,
} from '../lib/auth/account-deletion'
import { resolveParticipantDisplayName } from '../lib/invitations/display'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

const { sendJobMock } = vi.hoisted(() => ({
  sendJobMock: vi.fn(async () => crypto.randomUUID() as string | null),
}))
vi.mock('@spliit/jobs', async (importOriginal) => ({
  ...(await importOriginal()),
  sendJob: sendJobMock,
}))
vi.mock('../lib/api/boss', () => ({
  getApiBoss: async () => null,
  getApiBossForWrite: async () => ({}),
}))

await checkDbConnection()

/**
 * End-to-end account deletion against the real database (jobs stay disabled in
 * the integration env, so the PENDING request row is inserted directly and
 * `executeAccountDeletion` is invoked like the worker would).
 */
describe('Account deletion — real DB', () => {
  const runId = testRunId()
  const peerId = `acct-peer-${runId}`
  const peerEmail = `peer-${runId}@test.example`

  const ledgerIds: string[] = []
  const createdAccountIds: string[] = []

  function makeCaller(accountId: string, email: string, name: string) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: `sess-${accountId}`, createdAt: new Date() },
        user: { id: accountId, email, emailVerified: true, name },
      },
    } as never)
  }

  async function createDeleter(suffix: string, name: string) {
    const id = `acct-del-${suffix}-${runId}`
    const email = `del-${suffix}-${runId}@test.example`
    await prisma.user.create({
      data: { id, email, emailVerified: true, name },
    })
    createdAccountIds.push(id)
    return { id, email, name }
  }

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: peerId, email: peerEmail, emailVerified: true, name: 'Peer' },
    })
  })

  afterAll(async () => {
    for (const ledgerId of ledgerIds) {
      await prisma.ledger.delete({ where: { id: ledgerId } }).catch(() => {})
    }
    await prisma.accountDeletionRequest
      .deleteMany({ where: { accountId: { endsWith: runId } } })
      .catch(() => {})
    for (const accountId of [...createdAccountIds, peerId]) {
      await prisma.user.delete({ where: { id: accountId } }).catch(() => {})
    }
  })

  /**
   * A group with the deleter (ADMIN) plus the peer, one unsettled expense paid
   * by the deleter, one comment by the deleter, one pending invite sent by the
   * deleter, and one session row.
   */
  async function setupSharedGroup(deleter: {
    id: string
    email: string
    name: string
  }) {
    const tag = `${runId}-${ledgerIds.length}`
    const caller = makeCaller(deleter.id, deleter.email, deleter.name)
    const { groupId } = await caller.create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: `Shared ${tag}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: deleter.name }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })
    ledgerIds.push(group!.ledger.id)
    const deleterParticipant = group!.members[0].ledgerParticipant!

    const peerMemberId = `gm-peer-${tag}`
    const peerParticipantId = `lp-peer-${tag}`
    await prisma.groupMember.create({
      data: {
        id: peerMemberId,
        groupId,
        accountId: peerId,
        role: GroupRole.MEMBER,
        status: GroupMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
    })
    await prisma.ledgerParticipant.create({
      data: {
        id: peerParticipantId,
        ledgerId: group!.ledger.id,
        groupMemberId: peerMemberId,
      },
    })

    // $30 paid by the deleter, split evenly: the peer owes the deleter $15.
    const { expenseId } = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Shared dinner',
        amount: 3000,
        paidByList: [{ participant: deleterParticipant.id, shares: 3000 }],
        paidBySplitMode: 'BY_AMOUNT',
        paidFor: [
          { participant: deleterParticipant.id, shares: 1 },
          { participant: peerParticipantId, shares: 1 },
        ],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date('2026-09-01').toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const { comment: createdComment } = await caller.expenses.comments.create({
      requestId: crypto.randomUUID(),
      groupId,
      expenseId,
      body: 'I paid this one',
    })
    const comment = { id: createdComment.id }

    const invitation = await prisma.groupInvitation.create({
      data: {
        id: `gi-${tag}`,
        groupId,
        type: 'EMAIL',
        email: `invitee-${tag}@test.example`,
        invitedById: deleter.id,
      },
    })

    await prisma.session.create({
      data: {
        id: `sess-row-${tag}`,
        userId: deleter.id,
        token: `token-${tag}`,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })

    await prisma.accountDeletionRequest.upsert({
      where: { accountId: deleter.id },
      update: {},
      create: {
        accountId: deleter.id,
        emailSnapshot: deleter.email,
        displayNameSnapshot: deleter.name,
        keepDisplayName: false,
        executeAt: new Date(Date.now() - 1000),
        status: 'PENDING',
      },
    })

    return {
      groupId,
      ledgerId: group!.ledger.id,
      expenseId,
      commentId: comment.id,
      invitationId: invitation.id,
      deleterParticipantId: deleterParticipant.id,
      peerParticipantId,
      peerMemberId,
      deleterMemberId: group!.members[0].id,
    }
  }

  it('executes deletion: settles, anonymizes history, and removes the account', async () => {
    const deleter = await createDeleter('anon', 'Deleter')
    const setup = await setupSharedGroup(deleter)

    const acceptedInvitationId = `gi-accepted-${runId}`
    await prisma.groupInvitation.create({
      data: {
        id: acceptedInvitationId,
        groupId: setup.groupId,
        type: 'EMAIL',
        email: deleter.email,
        temporaryName: 'Private invite name',
        invitedById: peerId,
        acceptedById: deleter.id,
        status: 'ACCEPTED',
        ledgerParticipantId: setup.deleterParticipantId,
      },
    })
    await prisma.activity.create({
      data: {
        id: `act-invite-${runId}`,
        ledgerId: setup.ledgerId,
        type: 'INVITATION_ACCEPTED',
        actorType: 'ACCOUNT',
        actorId: deleter.id,
        subjectType: 'INVITATION',
        subjectId: acceptedInvitationId,
        data: { kind: 'invitation', displayLabel: deleter.email },
      },
    })
    await updateMemberRole({
      groupId: setup.groupId,
      memberId: setup.peerMemberId,
      role: 'ADMIN',
      actor: { accountId: deleter.id },
    })
    await updateMemberRole({
      groupId: setup.groupId,
      memberId: setup.deleterMemberId,
      role: 'MEMBER',
      actor: { accountId: peerId },
    })
    // Simulate a worker that died after committing its claim.
    await prisma.accountDeletionRequest.update({
      where: { accountId: deleter.id },
      data: { status: 'EXECUTING' },
    })

    const previewBalances = await getGroupBalances(setup.groupId)
    expect(previewBalances[setup.peerParticipantId]?.total).not.toBe(0)

    // Legacy comment activity row (the app no longer writes these, but old
    // databases still carry them): the scrub must cover it by linkage.
    await prisma.activity.create({
      data: {
        id: `act-comment-${runId}`,
        ledgerId: setup.ledgerId,
        type: 'EXPENSE_COMMENTED',
        actorType: 'ACCOUNT',
        actorId: deleter.id,
        subjectType: 'EXPENSE',
        subjectId: setup.expenseId,
        expenseCommentId: setup.commentId,
        data: {
          kind: 'expense_comment',
          commentId: setup.commentId,
          expenseTitle: 'Shared dinner',
          authorName: 'Deleter',
          excerpt: 'I paid this one',
        },
      },
    })

    const result = await executeAccountDeletion(deleter.id, null, new Date())
    expect(result).toEqual({ executed: true })

    // The account and its session are gone; the peer survives.
    await expect(
      prisma.user.findUnique({ where: { id: deleter.id } }),
    ).resolves.toBeNull()
    await expect(
      prisma.session.findMany({ where: { userId: deleter.id } }),
    ).resolves.toEqual([])
    await expect(
      prisma.user.findUnique({ where: { id: peerId } }),
    ).resolves.not.toBeNull()

    // The shared expense survives with a nulled creator; balances settled.
    const expense = await prisma.expense.findUnique({
      where: { id: setup.expenseId },
    })
    expect(expense).not.toBeNull()
    expect(expense!.createdByAccountId).toBeNull()
    const balances = await getGroupBalances(setup.groupId)
    expect(hasUnsettledBalances(balances)).toBe(false)

    // The participant became a name-only row with the generic label.
    const participant = await prisma.ledgerParticipant.findUnique({
      where: { id: setup.deleterParticipantId },
    })
    expect(participant).not.toBeNull()
    expect(participant!.kind).toBe('UNLINKED_PARTICIPANT')
    expect(participant!.displayName).toBe('Deleted member')
    expect(participant!.groupMemberId).toBeNull()

    const labelledParticipant = await prisma.ledgerParticipant.findUnique({
      where: { id: setup.deleterParticipantId },
      select: participantDisplayNameSelect(),
    })
    expect(resolveParticipantDisplayName(labelledParticipant!)).toBe(
      'Deleted member',
    )
    const acceptedInvitation = await prisma.groupInvitation.findUnique({
      where: { id: acceptedInvitationId },
    })
    expect(acceptedInvitation!.email).not.toBe(deleter.email)
    expect(acceptedInvitation!.temporaryName).toBe('Deleted member')
    const invitationActivity = await prisma.activity.findUnique({
      where: { id: `act-invite-${runId}` },
    })
    expect(
      (invitationActivity!.data as Record<string, unknown>).displayLabel,
    ).toBe('Deleted member')
    const roleActivities = await prisma.activity.findMany({
      where: { ledgerId: setup.ledgerId, type: 'MEMBER_ROLE_CHANGED' },
    })
    const peerRoleActivity = roleActivities.find(
      ({ subjectId }) => subjectId === setup.peerMemberId,
    )!
    expect(
      (peerRoleActivity.data as Record<string, unknown>).targetDisplayName,
    ).toBe('Peer')
    expect((peerRoleActivity.data as Record<string, unknown>).displayName).toBe(
      'Deleted member',
    )
    const deleterRoleActivity = roleActivities.find(
      ({ subjectId }) => subjectId === setup.deleterMemberId,
    )!
    expect(
      (deleterRoleActivity.data as Record<string, unknown>).targetDisplayName,
    ).toBe('Deleted member')
    expect(
      (deleterRoleActivity.data as Record<string, unknown>).displayName,
    ).toBe('Peer')

    // The comment keeps its text with a scrubbed author.
    const comment = await prisma.expenseComment.findUnique({
      where: { id: setup.commentId },
    })
    expect(comment!.authorAccountId).toBeNull()
    expect(comment!.authorName).toBe('Deleted member')
    expect(comment!.text).toBe('I paid this one')

    // Activity attribution is detached by linkage, not name matching: the
    // expense activity no longer points at the account, and the legacy
    // comment activity keeps its excerpt with a scrubbed author.
    const expenseActivity = await prisma.activity.findFirst({
      where: { subjectId: setup.expenseId, type: 'EXPENSE_CREATED' },
    })
    expect(expenseActivity).not.toBeNull()
    expect(expenseActivity!.actorId).toBeNull()
    const commentActivity = await prisma.activity.findFirst({
      where: { expenseCommentId: setup.commentId },
    })
    expect(commentActivity).not.toBeNull()
    expect((commentActivity!.data as Record<string, unknown>)?.authorName).toBe(
      'Deleted member',
    )
    expect((commentActivity!.data as Record<string, unknown>)?.excerpt).toBe(
      'I paid this one',
    )

    // The pending invite the deleter sent was revoked.
    const invitation = await prisma.groupInvitation.findUnique({
      where: { id: setup.invitationId },
    })
    expect(invitation!.status).toBe('REVOKED')

    // The request is closed and re-running is a no-op.
    const request = await prisma.accountDeletionRequest.findUnique({
      where: { accountId: deleter.id },
    })
    expect(request!.status).toBe('EXECUTED')
    await expect(
      executeAccountDeletion(deleter.id, null, new Date()),
    ).resolves.toEqual({ executed: false, reason: 'already-done' })
  })

  it('keeps the display name on shared history when requested', async () => {
    const deleter = await createDeleter('keep', 'Deleter Two')
    const setup = await setupSharedGroup(deleter)
    await prisma.accountDeletionRequest.update({
      where: { accountId: deleter.id },
      data: { keepDisplayName: true },
    })

    const result = await executeAccountDeletion(deleter.id, null, new Date())
    expect(result).toEqual({ executed: true })

    const participant = await prisma.ledgerParticipant.findUnique({
      where: { id: setup.deleterParticipantId },
    })
    expect(participant!.kind).toBe('UNLINKED_PARTICIPANT')
    expect(participant!.displayName).toBe('Deleter Two')

    const comment = await prisma.expenseComment.findUnique({
      where: { id: setup.commentId },
    })
    expect(comment!.authorName).toBe('Deleter Two')
  })

  it('leaves balances unsettled when the request opts out of settling', async () => {
    const deleter = await createDeleter('nosettle', 'Deleter Three')
    const setup = await setupSharedGroup(deleter)
    await prisma.accountDeletionRequest.update({
      where: { accountId: deleter.id },
      data: { settleBalances: false },
    })

    const result = await executeAccountDeletion(deleter.id, null, new Date())
    expect(result).toEqual({ executed: true })

    // No settlement expense was created: the peer still owes the remnant.
    const balances = await getGroupBalances(setup.groupId)
    expect(hasUnsettledBalances(balances)).toBe(true)
    expect(balances[setup.peerParticipantId]?.total).not.toBe(0)
    await expect(
      prisma.expense.count({ where: { ledgerId: setup.ledgerId } }),
    ).resolves.toBe(1)

    const participant = await prisma.ledgerParticipant.findUnique({
      where: { id: setup.deleterParticipantId },
    })
    expect(participant!.kind).toBe('UNLINKED_PARTICIPANT')
    expect(participant!.displayName).toBe('Deleted member')
  })

  it('keeps the friend ledger visible to the peer with the remnant name and no settlement', async () => {
    const deleter = await createDeleter('friend', 'Deleter Friend')
    const { createFriendLedger } = await import('../lib/api/friends')
    const { groupId } = await createFriendLedger({
      callerAccountId: deleter.id,
      peer: { accountId: peerId },
      currency: '$',
      currencyCode: 'USD',
    })
    const ledger = await prisma.group.findUnique({
      where: { id: groupId },
      select: {
        ledger: { select: { id: true } },
        members: {
          select: {
            id: true,
            accountId: true,
            ledgerParticipant: { select: { id: true } },
          },
        },
      },
    })
    ledgerIds.push(ledger!.ledger.id)
    const deleterMember = ledger!.members.find(
      (member) => member.accountId === deleter.id,
    )!
    const peerMember = ledger!.members.find(
      (member) => member.accountId === peerId,
    )!

    // $20 paid by the deleter, split evenly: the peer owes the remnant $10.
    const caller = makeCaller(deleter.id, deleter.email, deleter.name)
    const { expenseId } = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Friend dinner',
        amount: 2000,
        paidByList: [
          { participant: deleterMember.ledgerParticipant!.id, shares: 2000 },
        ],
        paidBySplitMode: 'BY_AMOUNT',
        paidFor: [
          { participant: deleterMember.ledgerParticipant!.id, shares: 1 },
          { participant: peerMember.ledgerParticipant!.id, shares: 1 },
        ],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date('2026-09-01').toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    await prisma.accountDeletionRequest.create({
      data: {
        accountId: deleter.id,
        emailSnapshot: deleter.email,
        displayNameSnapshot: deleter.name,
        keepDisplayName: true,
        displayNameOverride: 'Al Remembered',
        settleBalances: false,
        executeAt: new Date(Date.now() - 1000),
        status: 'PENDING',
      },
    })

    const result = await executeAccountDeletion(deleter.id, null, new Date())
    expect(result).toEqual({ executed: true })

    // The ledger survives with the peer active; the deleter's membership
    // cascades away with the user delete, so the peer keeps seeing it. The
    // balance stays on the remnant name.
    await expect(
      prisma.group.findUnique({ where: { id: groupId } }),
    ).resolves.not.toBeNull()
    const memberships = await prisma.groupMember.findMany({
      where: { groupId },
      select: { accountId: true, status: true },
    })
    expect(
      memberships.find((member) => member.accountId === peerId)?.status,
    ).toBe('ACTIVE')
    expect(memberships.some((member) => member.accountId === deleter.id)).toBe(
      false,
    )
    const balances = await getGroupBalances(groupId)
    expect(hasUnsettledBalances(balances)).toBe(true)

    const participant = await prisma.ledgerParticipant.findUnique({
      where: { id: deleterMember.ledgerParticipant!.id },
    })
    expect(participant!.kind).toBe('UNLINKED_PARTICIPANT')
    expect(participant!.displayName).toBe('Al Remembered')

    // Peer-side read proves visibility: the group loads and the expense
    // history still references the remnant participant.
    const peerCaller = makeCaller(peerId, peerEmail, 'Peer')
    const fetched = await peerCaller.get({ groupId })
    expect(fetched.group.id).toBe(groupId)
    const fetchedExpense = await peerCaller.expenses.get({
      groupId,
      expenseId,
    })
    expect(fetchedExpense.expense.id).toBe(expenseId)
  })

  it('settles archived active memberships and keeps groups manageable', async () => {
    const deleter = await createDeleter('archived', 'Archived Admin')
    const setup = await setupSharedGroup(deleter)
    await prisma.group.update({
      where: { id: setup.groupId },
      data: { archived: true },
    })
    expect(await executeAccountDeletion(deleter.id)).toEqual({ executed: true })
    const peerCaller = makeCaller(peerId, peerEmail, 'Peer')
    const result = await peerCaller.archive({
      groupId: setup.groupId,
      archived: false,
    })
    expect(result.group.archived).toBe(false)
    expect(hasUnsettledBalances(await getGroupBalances(setup.groupId))).toBe(
      false,
    )
  })

  it('does not run a second executor while another worker holds the account lock', async () => {
    const deleter = await createDeleter('locked', 'Locked')
    const setup = await setupSharedGroup(deleter)
    await prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<
        Array<{ acquired: boolean }>
      >`SELECT pg_try_advisory_xact_lock(hashtextextended(${`account-deletion:${deleter.id}`}, 0)) AS acquired`
      expect(lock.acquired).toBe(true)
      expect(await executeAccountDeletion(deleter.id)).toEqual({
        executed: false,
        reason: 'already-running',
      })
      expect(
        await prisma.user.findUnique({ where: { id: deleter.id } }),
      ).not.toBeNull()
      expect(
        await prisma.groupMember.findUnique({
          where: { id: setup.deleterMemberId },
        }),
      ).toMatchObject({ status: 'ACTIVE' })
    })
    expect(await executeAccountDeletion(deleter.id)).toEqual({ executed: true })
  })

  it('deletes groups where the deleter is the last member', async () => {
    const deleter = await createDeleter('solo', 'Solo')
    const caller = makeCaller(deleter.id, deleter.email, deleter.name)
    const { groupId } = await caller.create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: `Solo ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: deleter.name }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { ledger: true },
    })
    ledgerIds.push(group!.ledger.id)

    await prisma.accountDeletionRequest.create({
      data: {
        accountId: deleter.id,
        emailSnapshot: deleter.email,
        displayNameSnapshot: deleter.name,
        keepDisplayName: false,
        executeAt: new Date(Date.now() - 1000),
        status: 'PENDING',
      },
    })

    const result = await executeAccountDeletion(deleter.id, null, new Date())
    expect(result).toEqual({ executed: true })
    await expect(
      prisma.group.findUnique({ where: { id: groupId } }),
    ).resolves.toBeNull()
    await expect(
      prisma.user.findUnique({ where: { id: deleter.id } }),
    ).resolves.toBeNull()
  })
  it.each([false, true])(
    'uses current groups and expenses during execution (settle=%s)',
    async (settleBalances) => {
      const deleter = await createDeleter(
        `changes-${settleBalances}`,
        'Original name',
      )
      const before = await setupSharedGroup(deleter)
      const preview = await getDeletionPreview(deleter.id)
      expect(preview.groups).toHaveLength(1)
      await prisma.accountDeletionRequest.update({
        where: { accountId: deleter.id },
        data: {
          keepDisplayName: true,
          settleBalances,
        },
      })
      await prisma.user.update({
        where: { id: deleter.id },
        data: { name: 'Later profile name' },
      })
      const joined = await setupSharedGroup(deleter)
      // A new expense arrives after review, changing the amount to settle.
      const caller = makeCaller(deleter.id, deleter.email, 'Later profile name')
      await caller.expenses.create({
        requestId: crypto.randomUUID(),
        groupId: joined.groupId,
        expense: {
          title: 'During waiting period',
          amount: 2000,
          paidByList: [
            { participant: joined.deleterParticipantId, shares: 2000 },
          ],
          paidBySplitMode: 'BY_AMOUNT',
          paidFor: [
            { participant: joined.deleterParticipantId, shares: 1 },
            { participant: joined.peerParticipantId, shares: 1 },
          ],
          category: 'general',
          splitMode: 'EVENLY',
          expenseDate: new Date().toISOString(),
          expenseTimeZone: 'UTC',
          documents: [],
          recurrenceRule: 'NONE',
        },
      })
      // Another member departs: the originally shared group becomes deletable.
      await prisma.groupMember.update({
        where: { id: before.peerMemberId },
        data: { status: 'LEFT' },
      })
      expect(await executeAccountDeletion(deleter.id)).toEqual({
        executed: true,
      })
      expect(
        await prisma.group.findUnique({ where: { id: before.groupId } }),
      ).toBeNull()
      const remnant = await prisma.ledgerParticipant.findUnique({
        where: { id: joined.deleterParticipantId },
      })
      expect(remnant).toMatchObject({
        kind: 'UNLINKED_PARTICIPANT',
        displayName: 'Original name',
      })
      const balances = await getGroupBalances(joined.groupId)
      expect(balances[joined.deleterParticipantId]?.total ?? 0).toBe(
        settleBalances ? 0 : 2500,
      )
      expect(
        await prisma.groupMember.findUnique({
          where: { id: joined.peerMemberId },
        }),
      ).toMatchObject({ role: 'ADMIN' })
    },
  )

  it.each(['LEFT', 'REMOVED'] as const)(
    'preserves balances for a membership already %s before execution',
    async (status) => {
      const deleter = await createDeleter(`departed-${status}`, 'Departed')
      const setup = await setupSharedGroup(deleter)
      await prisma.groupMember.update({
        where: { id: setup.deleterMemberId },
        data: { status },
      })
      expect(await executeAccountDeletion(deleter.id)).toEqual({
        executed: true,
      })
      expect(
        (await getGroupBalances(setup.groupId))[setup.deleterParticipantId]
          ?.total,
      ).toBe(1500)
      expect(
        await prisma.ledgerParticipant.findUnique({
          where: { id: setup.deleterParticipantId },
        }),
      ).toMatchObject({
        kind: 'UNLINKED_PARTICIPANT',
        displayName: 'Deleted member',
      })
    },
  )

  it('keeps a formerly solo group when another member joins before execution', async () => {
    const deleter = await createDeleter('new-peer', 'New peer')
    const setup = await setupSharedGroup(deleter)
    await prisma.groupMember.update({
      where: { id: setup.peerMemberId },
      data: { status: 'LEFT' },
    })
    expect(
      (await getDeletionPreview(deleter.id)).groups[0].willDeleteGroup,
    ).toBe(true)
    await prisma.groupMember.update({
      where: { id: setup.peerMemberId },
      data: { status: 'ACTIVE' },
    })
    expect(await executeAccountDeletion(deleter.id)).toEqual({ executed: true })
    expect(
      await prisma.group.findUnique({ where: { id: setup.groupId } }),
    ).not.toBeNull()
    expect(
      await prisma.groupMember.findUnique({
        where: { id: setup.peerMemberId },
      }),
    ).toMatchObject({ role: 'ADMIN' })
  })

  it('finishes deletion when a reviewed group has already been deleted', async () => {
    const deleter = await createDeleter('gone-group', 'Gone group')
    const setup = await setupSharedGroup(deleter)
    expect((await getDeletionPreview(deleter.id)).groups).toHaveLength(1)
    await prisma.group.delete({ where: { id: setup.groupId } })
    expect(await executeAccountDeletion(deleter.id)).toEqual({ executed: true })
    expect(
      await prisma.user.findUnique({ where: { id: deleter.id } }),
    ).toBeNull()
  })

  it('cannot cancel after partial execution and resumes without duplicate settlements', async () => {
    const deleter = await createDeleter('partial', 'Partial')
    const setup = await setupSharedGroup(deleter)
    const fault = vi
      .spyOn(prisma.expenseComment, 'findMany')
      .mockRejectedValueOnce(new Error('interrupted after group exit'))
    try {
      await expect(executeAccountDeletion(deleter.id)).rejects.toThrow(
        'interrupted after group exit',
      )
    } finally {
      fault.mockRestore()
    }
    expect(
      await prisma.accountDeletionRequest.findUnique({
        where: { accountId: deleter.id },
      }),
    ).toMatchObject({ status: 'EXECUTING' })
    expect(hasUnsettledBalances(await getGroupBalances(setup.groupId))).toBe(
      false,
    )
    const settledCount = await prisma.expense.count({
      where: { ledgerId: setup.ledgerId },
    })
    await expect(cancelAccountDeletion(deleter.id)).rejects.toMatchObject({
      code: 'noPendingRequest',
    })
    expect(await executeAccountDeletion(deleter.id)).toEqual({ executed: true })
    expect(
      await prisma.expense.count({ where: { ledgerId: setup.ledgerId } }),
    ).toBe(settledCount)
  })

  it('rejects old and legacy jobs after cancel and reschedule, then executes the current generation', async () => {
    const deleter = await createDeleter('generation', 'Generation')
    const now = new Date()
    const input = {
      accountId: deleter.id,
      email: deleter.email,
      keepDisplayName: true,
      sessionCreatedAt: now,
      now,
    }
    await requestAccountDeletion(input)
    const original = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { accountId: deleter.id },
    })
    await cancelAccountDeletion(deleter.id, now)
    expect(
      await executeAccountDeletion(
        deleter.id,
        null,
        original.executeAt,
        original.generation!,
      ),
    ).toEqual({ executed: false, reason: 'cancelled' })
    await requestAccountDeletion({
      ...input,
      now: new Date(now.getTime() + 1000),
    })
    const replacement = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { accountId: deleter.id },
    })
    expect(replacement.generation).not.toBe(original.generation)
    expect(replacement.executeAt.getTime()).toBe(
      original.executeAt.getTime() + 1000,
    )
    for (const generation of [undefined, original.generation!]) {
      expect(
        await executeAccountDeletion(
          deleter.id,
          null,
          replacement.executeAt,
          generation,
        ),
      ).toEqual({ executed: false, reason: 'superseded' })
    }
    expect(
      await executeAccountDeletion(
        deleter.id,
        null,
        now,
        replacement.generation!,
      ),
    ).toEqual({ executed: false, reason: 'not-due' })
    expect(
      await executeAccountDeletion(
        deleter.id,
        null,
        replacement.executeAt,
        replacement.generation!,
      ),
    ).toEqual({ executed: true })
  })

  it.each(['rejected', 'missing-id'])(
    'rolls back rescheduling when enqueue is %s',
    async (failure) => {
      const deleter = await createDeleter(`enqueue-${failure}`, 'Enqueue')
      const now = new Date()
      const input = {
        accountId: deleter.id,
        email: deleter.email,
        keepDisplayName: false,
        sessionCreatedAt: now,
        now,
      }
      await requestAccountDeletion(input)
      await cancelAccountDeletion(deleter.id)
      const cancelled = await prisma.accountDeletionRequest.findUniqueOrThrow({
        where: { accountId: deleter.id },
      })
      if (failure === 'rejected')
        sendJobMock.mockRejectedValueOnce(new Error('queue unavailable'))
      else sendJobMock.mockResolvedValueOnce(null)
      await expect(requestAccountDeletion(input)).rejects.toThrow()
      expect(
        await prisma.accountDeletionRequest.findUniqueOrThrow({
          where: { accountId: deleter.id },
        }),
      ).toEqual(cancelled)
      await requestAccountDeletion(input)
      expect(
        await prisma.accountDeletionRequest.findUnique({
          where: { accountId: deleter.id },
        }),
      ).toMatchObject({ status: 'PENDING', jobId: expect.any(String) })
    },
  )

  it('allows only one simultaneous scheduling request', async () => {
    const deleter = await createDeleter('duplicate', 'Duplicate')
    const now = new Date()
    const input = {
      accountId: deleter.id,
      email: deleter.email,
      keepDisplayName: false,
      sessionCreatedAt: now,
      now,
    }
    const results = await Promise.allSettled([
      requestAccountDeletion(input),
      requestAccountDeletion(input),
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: { code: 'alreadyRequested' } })
  })
})
