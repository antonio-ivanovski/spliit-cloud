import { GroupMemberStatus, GroupRole, prisma } from '@spliit/db'

import { deleteS3Object } from '../../routes/upload'
import {
  buildGroupActivityData,
  buildMemberActivityData,
  logActivity,
  planNotificationForActivity,
} from './activities'
import {
  createSettlementExpensesForLeave,
  getGroupBalances,
  type SettlementActivityMeta,
} from './balances'
import { getApiBoss } from './boss'
import { memberWithLedgerParticipantSelect } from './selects/member-with-ledger-participant'
import { randomId } from './shared'
import { removeParticipantFromSubgroup } from './subgroups'

/** Update a member's role inside a group. */
export async function updateMemberRole(opts: {
  groupId: string
  memberId: string
  role: 'ADMIN' | 'MEMBER'
  actor: { accountId: string }
}) {
  const { groupId, memberId, role, actor } = opts

  const target = await prisma.groupMember.findUnique({
    where: { id: memberId },
    select: memberWithLedgerParticipantSelect({ includeAccount: false }),
  })
  if (!target || target.groupId !== groupId) {
    throw new Error('Member not found in this group')
  }
  if (target.status !== GroupMemberStatus.ACTIVE) {
    throw new Error('Only active members can be updated')
  }
  if (target.accountId === actor.accountId) {
    throw new Error('You cannot change your own role here; use the leave flow')
  }
  if (target.role === role) {
    return target
  }

  const targetAccount = await prisma.account.findUnique({
    where: { id: target.accountId },
    select: { name: true },
  })
  const actorAccount = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { name: true },
  })

  const boss = await getApiBoss()
  const result = await prisma.$transaction(async (tx) => {
    if (role !== GroupRole.ADMIN && target.role === GroupRole.ADMIN) {
      const remainingAdmins = await tx.groupMember.count({
        where: {
          groupId,
          status: GroupMemberStatus.ACTIVE,
          role: GroupRole.ADMIN,
          NOT: { id: memberId },
        },
      })
      if (remainingAdmins === 0) {
        throw new Error('Group must keep at least one admin')
      }
    }
    const updated = await tx.groupMember.update({
      where: { id: memberId },
      data: { role },
    })
    const activity = await logActivity(
      groupId,
      {
        type: 'MEMBER_ROLE_CHANGED',
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'MEMBER', id: memberId },
        data: buildMemberActivityData({
          displayName: actorAccount?.name ?? undefined,
          targetDisplayName: targetAccount?.name ?? undefined,
          previousRole: target.role,
          nextRole: role,
        }),
      },
      tx,
    )
    await planNotificationForActivity(tx, activity, {}, { boss })
    return { updated, activity }
  })
  return result.updated
}

export class RemoveMemberPreconditionError extends Error {
  constructor(
    public readonly reason: 'unsettledBalance',
    message: string,
  ) {
    super(message)
    this.name = 'RemoveMemberPreconditionError'
  }
}

export async function removeMember(opts: {
  groupId: string
  memberId: string
  settleBalances?: boolean
  actor: { accountId: string }
}) {
  const { groupId, memberId, settleBalances, actor } = opts

  const target = await prisma.groupMember.findUnique({
    where: { id: memberId },
    select: memberWithLedgerParticipantSelect({ includeAccount: true }),
  })
  if (!target || target.groupId !== groupId) {
    throw new Error('Member not found in this group')
  }
  if (target.status !== GroupMemberStatus.ACTIVE) {
    throw new Error('Member is not active')
  }
  if (target.accountId === actor.accountId) {
    throw new Error(
      'You cannot remove yourself here; use the leave group flow instead',
    )
  }

  let hasUnsettledBalance = false
  if (target.ledgerParticipant?.id) {
    const balances = await getGroupBalances(groupId)
    hasUnsettledBalance =
      (balances[target.ledgerParticipant.id]?.total ?? 0) !== 0
  }
  if (hasUnsettledBalance && settleBalances === undefined) {
    throw new RemoveMemberPreconditionError(
      'unsettledBalance',
      'Member has unsettled balances. Settle them first or remove without settling.',
    )
  }

  const actorAccount = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { name: true },
  })

  const boss = await getApiBoss()
  const result = await prisma.$transaction(async (tx) => {
    let settlementActivities = undefined as
      | Awaited<
          ReturnType<typeof createSettlementExpensesForLeave>
        >['activities']
      | undefined
    if (settleBalances && target.ledgerParticipant?.id) {
      const r = await createSettlementExpensesForLeave(
        groupId,
        target.ledgerParticipant.id,
        actor,
        tx,
      )
      settlementActivities = r.activities
    }

    if (target.role === GroupRole.ADMIN) {
      const remainingAdmins = await tx.groupMember.count({
        where: {
          groupId,
          status: GroupMemberStatus.ACTIVE,
          role: GroupRole.ADMIN,
          NOT: { id: memberId },
        },
      })
      if (remainingAdmins === 0) {
        throw new Error('Group must keep at least one admin')
      }
    }
    const updated = await tx.groupMember.update({
      where: { id: memberId },
      data: {
        status: GroupMemberStatus.REMOVED,
        leftAt: new Date(),
      },
    })
    const activity = await logActivity(
      groupId,
      {
        type: 'MEMBER_REMOVED',
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'MEMBER', id: memberId },
        data: buildMemberActivityData({
          displayName: actorAccount?.name ?? undefined,
          targetDisplayName: target.account?.name ?? undefined,
          summary: settleBalances ? 'member:removed:settled' : 'member:removed',
        }),
      },
      tx,
    )
    if (target.ledgerParticipant?.id) {
      await tx.ledgerParticipant.update({
        where: { id: target.ledgerParticipant.id },
        data: { removedAt: new Date() },
      })
      await removeParticipantFromSubgroup(target.ledgerParticipant.id, tx)
    }
    await planNotificationForActivity(tx, activity, {}, { boss })
    for (const settlementActivity of settlementActivities ?? []) {
      await planNotificationForActivity(
        tx,
        settlementActivity.activity,
        {},
        { boss },
      )
    }
    return { updated, settlementActivities, activity }
  })
  return result.updated
}

export class LeaveGroupPreconditionError extends Error {
  constructor(
    public readonly reason:
      | 'lastMemberMustDelete'
      | 'promotionRequired'
      | 'unsettledBalance',
    message: string,
  ) {
    super(message)
    this.name = 'LeaveGroupPreconditionError'
  }
}

/**
 * Permanently delete a group, its ledger, expenses, invitations, and attached
 * S3 documents. Used by the admin "Delete group" affordance surfaced on the
 * settings page. The caller must be an active member of the group; the
 * admin-only authorization is enforced by the surrounding tRPC procedure so
 * this helper stays reusable.
 *
 * The S3 cleanup mirrors `deleteExpense`: enumerate every document on the
 * group's ledger and delete the remote object before the cascade removes the
 * row, so we never leave orphans behind.
 */
export async function deleteGroup(opts: {
  groupId: string
  actor: { accountId: string }
}): Promise<{ deleted: true }> {
  const { groupId } = opts

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { archived: true, ledgerId: true },
  })
  if (!group) throw new Error('Invalid group ID')

  const documents = await prisma.expenseDocument.findMany({
    where: { ledgerId: group.ledgerId },
    select: { url: true },
  })
  await Promise.all(documents.map((doc) => deleteS3Object(doc.url)))

  await prisma.group.delete({ where: { id: groupId } })
  return { deleted: true }
}

export async function leaveGroup(opts: {
  groupId: string
  actor: { accountId: string }
  force?: boolean
  promoteMemberId?: string
}): Promise<{
  promotedMemberId: string | null
}> {
  const { groupId, actor, force = false, promoteMemberId } = opts

  const member = await prisma.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId: actor.accountId } },
    select: memberWithLedgerParticipantSelect({ includeAccount: true }),
  })
  if (!member || member.status !== GroupMemberStatus.ACTIVE) {
    throw new Error('You are not an active member of this group')
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { archived: true },
  })
  if (!group) throw new Error('Invalid group ID')
  if (group.archived) {
    throw new Error('Cannot leave an archived group')
  }

  const [otherAdminsCount, otherMembersCount] = await Promise.all([
    prisma.groupMember.count({
      where: {
        groupId,
        status: GroupMemberStatus.ACTIVE,
        role: GroupRole.ADMIN,
        NOT: { id: member.id },
      },
    }),
    prisma.groupMember.count({
      where: {
        groupId,
        status: GroupMemberStatus.ACTIVE,
        NOT: { id: member.id },
      },
    }),
  ])

  const isLastActiveMember = otherMembersCount === 0
  const isLastAdmin = member.role === GroupRole.ADMIN && otherAdminsCount === 0

  if (isLastActiveMember) {
    throw new LeaveGroupPreconditionError(
      'lastMemberMustDelete',
      'You are the last active member. Delete the group from the settings to continue.',
    )
  }

  if (isLastAdmin) {
    if (!promoteMemberId) {
      throw new LeaveGroupPreconditionError(
        'promotionRequired',
        'You are the last admin. Choose a member to promote before leaving.',
      )
    }
    const target = await prisma.groupMember.findUnique({
      where: { id: promoteMemberId },
      select: {
        id: true,
        groupId: true,
        status: true,
        accountId: true,
      },
    })
    if (
      !target ||
      target.groupId !== groupId ||
      target.status !== GroupMemberStatus.ACTIVE
    ) {
      throw new Error('Promotion target must be an active member of this group')
    }
    if (target.id === member.id) {
      throw new Error('You cannot promote yourself before leaving')
    }
  }

  const participantId = member.ledgerParticipant?.id ?? null
  let needsSettlement = false
  if (participantId) {
    const balances = await getGroupBalances(groupId)
    const total = balances[participantId]?.total ?? 0
    needsSettlement = total !== 0
  }
  if (needsSettlement && !force) {
    throw new LeaveGroupPreconditionError(
      'unsettledBalance',
      'You have unsettled balances. Settle or force-leave to continue.',
    )
  }

  const boss = await getApiBoss()
  const result = await prisma.$transaction(async (tx) => {
    let settlementActivities: SettlementActivityMeta[] = []
    if (needsSettlement && participantId) {
      const settlement = await createSettlementExpensesForLeave(
        groupId,
        participantId,
        actor,
        tx,
      )
      settlementActivities = settlement.activities
    }

    if (isLastAdmin && promoteMemberId) {
      await tx.groupMember.update({
        where: { id: promoteMemberId },
        data: { role: GroupRole.ADMIN },
      })
    }

    await tx.groupMember.update({
      where: { id: member.id },
      data: {
        status: GroupMemberStatus.LEFT,
        leftAt: new Date(),
      },
    })
    if (participantId) {
      await removeParticipantFromSubgroup(participantId, tx)
    }

    const activity = await logActivity(
      groupId,
      {
        type: 'MEMBER_LEFT',
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'MEMBER', id: member.id },
        data: buildMemberActivityData({
          displayName: member.account?.name ?? undefined,
          targetDisplayName: member.account?.name ?? undefined,
          summary: 'member:left',
        }),
      },
      tx,
    )

    await planNotificationForActivity(tx, activity, {}, { boss })
    for (const settlementActivity of settlementActivities) {
      await planNotificationForActivity(
        tx,
        settlementActivity.activity,
        {},
        { boss },
      )
    }
    return {
      promotedMemberId: isLastAdmin ? (promoteMemberId ?? null) : null,
      settlementActivities,
      activity,
    }
  })

  return { promotedMemberId: result.promotedMemberId }
}

export async function archiveGroupForSelf(opts: {
  groupId: string
  accountId: string
}): Promise<{ archived: true }> {
  const { groupId, accountId } = opts

  const member = await prisma.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId } },
    select: memberWithLedgerParticipantSelect({ includeAccount: false }),
  })
  if (!member || member.status !== GroupMemberStatus.ACTIVE) {
    throw new Error('You are not an active member of this group')
  }

  const otherActiveMembers = await prisma.groupMember.count({
    where: {
      groupId,
      status: GroupMemberStatus.ACTIVE,
      NOT: { id: member.id },
    },
  })
  if (otherActiveMembers > 0) {
    throw new Error(
      'Archive-for-self is only available when you are the last active member',
    )
  }

  const boss = await getApiBoss()
  await prisma.$transaction(async (tx) => {
    await tx.group.update({
      where: { id: groupId },
      data: { archived: true },
    })

    await tx.accountGroupPreference.upsert({
      where: { accountId_groupId: { accountId, groupId } },
      create: {
        id: randomId(),
        accountId,
        groupId,
        hidden: true,
      },
      update: {
        hidden: true,
      },
    })

    const activity = await logActivity(
      groupId,
      {
        type: 'GROUP_ARCHIVED',
        actor: { type: 'ACCOUNT', id: accountId },
        subject: { type: 'GROUP', id: groupId },
        data: buildGroupActivityData({ summary: 'group:archived-on-leave' }),
      },
      tx,
    )
    await planNotificationForActivity(tx, activity, {}, { boss })
  })

  return { archived: true }
}

export async function getLeavePreview(opts: {
  groupId: string
  accountId: string
}): Promise<{
  role: GroupRole
  isLastActiveMember: boolean
  isLastAdmin: boolean
  hasUnsettledBalance: boolean
  otherAdmins: Array<{ id: string; name: string }>
  promotableMembers: Array<{ id: string; name: string }>
}> {
  const { groupId, accountId } = opts

  const member = await prisma.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId } },
    select: memberWithLedgerParticipantSelect({ includeAccount: false }),
  })
  if (!member || member.status !== GroupMemberStatus.ACTIVE) {
    throw new Error('You are not an active member of this group')
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { archived: true },
  })
  if (!group) throw new Error('Invalid group ID')

  const otherActiveMembers = await prisma.groupMember.findMany({
    where: {
      groupId,
      status: GroupMemberStatus.ACTIVE,
      NOT: { id: member.id },
    },
    select: {
      id: true,
      role: true,
      account: { select: { id: true, name: true } },
    },
    orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
  })

  const otherAdmins = otherActiveMembers
    .filter((m) => m.role === GroupRole.ADMIN)
    .map((m) => ({ id: m.id, name: m.account?.name ?? '' }))

  const promotableMembers = otherActiveMembers.map((m) => ({
    id: m.id,
    name: m.account?.name ?? '',
  }))

  const participantId = member.ledgerParticipant?.id ?? null
  let hasUnsettledBalance = false
  if (participantId) {
    const balances = await getGroupBalances(groupId)
    hasUnsettledBalance = (balances[participantId]?.total ?? 0) !== 0
  }

  return {
    role: member.role,
    isLastActiveMember: otherActiveMembers.length === 0,
    isLastAdmin:
      member.role === GroupRole.ADMIN &&
      !otherActiveMembers.some((m) => m.role === GroupRole.ADMIN),
    hasUnsettledBalance,
    otherAdmins,
    promotableMembers,
  }
}

export async function getRemoveMemberPreview(opts: {
  groupId: string
  memberId: string
}): Promise<{
  memberName: string
  hasUnsettledBalance: boolean
}> {
  const { groupId, memberId } = opts

  const target = await prisma.groupMember.findUnique({
    where: { id: memberId },
    select: memberWithLedgerParticipantSelect({ includeAccount: true }),
  })
  if (!target || target.groupId !== groupId) {
    throw new Error('Member not found in this group')
  }

  let hasUnsettledBalance = false
  if (target.ledgerParticipant?.id) {
    const balances = await getGroupBalances(groupId)
    hasUnsettledBalance =
      (balances[target.ledgerParticipant.id]?.total ?? 0) !== 0
  }

  return {
    memberName: target.account?.name ?? '',
    hasUnsettledBalance,
  }
}
