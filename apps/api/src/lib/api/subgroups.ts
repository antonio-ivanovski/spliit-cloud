import { prisma, type Prisma } from '@spliit/db'

export const subgroupWithMembersSelect = {
  id: true,
  name: true,
  members: {
    orderBy: { ledgerParticipantId: 'asc' },
    select: { ledgerParticipantId: true },
  },
} satisfies Prisma.SubgroupSelect

export type SubgroupWithMembers = Prisma.SubgroupGetPayload<{
  select: typeof subgroupWithMembersSelect
}>

export function mapSubgroup(subgroup: SubgroupWithMembers) {
  return {
    id: subgroup.id,
    name: subgroup.name,
    participantIds: subgroup.members.map(
      ({ ledgerParticipantId }) => ledgerParticipantId,
    ),
  }
}

export async function listSubgroups(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      subgroupsEnabled: true,
      subgroups: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: subgroupWithMembersSelect,
      },
    },
  })
  if (!group) return null
  return {
    enabled: group.subgroupsEnabled,
    subgroups: group.subgroups.map(mapSubgroup),
  }
}

export async function removeParticipantFromSubgroup(
  ledgerParticipantId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const membership = await client.subgroupMember.findUnique({
    where: { ledgerParticipantId },
    select: { subgroupId: true },
  })
  if (!membership) return

  await client.subgroupMember.delete({
    where: {
      subgroupId_ledgerParticipantId: {
        subgroupId: membership.subgroupId,
        ledgerParticipantId,
      },
    },
  })

  const remaining = await client.subgroupMember.count({
    where: { subgroupId: membership.subgroupId },
  })
  if (remaining < 2) {
    await client.subgroup.delete({ where: { id: membership.subgroupId } })
  }
}
