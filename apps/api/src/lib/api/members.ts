import { GroupMemberStatus, GroupRole, prisma } from '@spliit/db'
import {
  buildGroupActivityData,
  buildMemberActivityData,
  logActivity,
} from './activities'
import { createSettlementExpensesForLeave, getGroupBalances } from './balances'
import { randomId } from './shared'

/**
 * Update a member's role inside a group.
 */
export async function updateMemberRole(opts: {
  groupId: string
  memberId: string
  role: 'ADMIN' | 'MEMBER'
  actor: { accountId: string }
}) {
  const { groupId, memberId, role, actor } = opts

  const target = await prisma.groupMember.findUnique({
    where: { id: memberId },
    include: { ledgerParticipant: { select: { id: true } } },
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

  return prisma.$transaction(async (tx) => {
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
    await logActivity(
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
    return updated
  })
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
    include: {
      ledgerParticipant: { select: { id: true } },
      account: { select: { name: true } },
    },
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

  return prisma.$transaction(async (tx) => {
    if (settleBalances && target.ledgerParticipant?.id) {
      await createSettlementExpensesForLeave(
        groupId,
        target.ledgerParticipant.id,
        actor,
        tx,
      )
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
    await logActivity(
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
    return updated
  })
}

export class LeaveGroupPreconditionError extends Error {
  constructor(
    public readonly reason:
      'confirmDeleteRequired' | 'promotionRequired' | 'unsettledBalance',
    message: string,
  ) {
    super(message)
    this.name = 'LeaveGroupPreconditionError'
  }
}

export async function leaveGroup(opts: {
  groupId: string
  actor: { accountId: string }
  force?: boolean
  promoteMemberId?: string
  confirmDelete?: boolean
}): Promise<{
  deleted: boolean
  promotedMemberId: string | null
}> {
  const {
    groupId,
    actor,
    force = false,
    promoteMemberId,
    confirmDelete = false,
  } = opts

  const member = await prisma.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId: actor.accountId } },
    include: {
      ledgerParticipant: { select: { id: true } },
      account: { select: { name: true } },
    },
  })
  if (!member || member.status !== GroupMemberStatus.ACTIVE) {
    throw new Error('You are not an active member of this group')
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { archived: true, ledgerId: true },
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
    if (!confirmDelete) {
      throw new LeaveGroupPreconditionError(
        'confirmDeleteRequired',
        'You are the last active member. Confirm deletion to continue.',
      )
    }
    await prisma.group.delete({ where: { id: groupId } })
    return { deleted: true, promotedMemberId: null }
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

  return prisma.$transaction(async (tx) => {
    if (needsSettlement && participantId) {
      await createSettlementExpensesForLeave(groupId, participantId, actor, tx)
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

    await logActivity(
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

    return {
      deleted: false,
      promotedMemberId: isLastAdmin ? (promoteMemberId ?? null) : null,
    }
  })
}

export async function archiveGroupForSelf(opts: {
  groupId: string
  accountId: string
}): Promise<{ archived: true }> {
  const { groupId, accountId } = opts

  const member = await prisma.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId } },
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
        archived: true,
      },
      update: {
        archived: true,
      },
    })

    await logActivity(
      groupId,
      {
        type: 'GROUP_ARCHIVED',
        actor: { type: 'ACCOUNT', id: accountId },
        subject: { type: 'GROUP', id: groupId },
        data: buildGroupActivityData({ summary: 'group:archived-on-leave' }),
      },
      tx,
    )
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
    include: { ledgerParticipant: { select: { id: true } } },
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
    include: {
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
    include: {
      account: { select: { name: true } },
      ledgerParticipant: { select: { id: true } },
    },
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
