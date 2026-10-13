import { GroupMemberStatus, GroupType, prisma } from '@spliit/db'

import { groupViewKeysMatch } from '../group-view'
import type { ShareMemberSample } from '../invitations/link-invitations'

export type ViewSharePreview = {
  group: {
    id: string
    name: string
    emoji: string | null
    color: string | null
    currencyCode: string | null
  }
  memberCount: number
  memberSample: ShareMemberSample[]
  usable: boolean
}

/**
 * Public-safe preview of a read-only `?viewKey=` share, for social unfurls.
 * Returns only branding + headcount fields — never expenses, balances, or
 * contact details. Null when the group is missing, is not a GROUP-type group
 * (friend ledgers have no view key), or the key does not match.
 */
export async function getGroupViewSharePreview(
  groupId: string,
  viewKey: string,
): Promise<ViewSharePreview | null> {
  const candidate = viewKey.trim()
  if (!candidate) return null
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      groupType: true,
      emoji: true,
      color: true,
      publicViewKey: true,
      ledger: { select: { currencyCode: true } },
    },
  })
  if (!group || group.groupType !== GroupType.GROUP) return null
  if (!group.publicViewKey) return null
  if (!groupViewKeysMatch(group.publicViewKey, candidate)) return null

  const [count, sample] = await Promise.all([
    Promise.resolve(
      prisma.groupMember.count({
        where: { groupId, status: GroupMemberStatus.ACTIVE },
      }),
    ).catch(() => 0),
    Promise.resolve(
      prisma.groupMember.findMany({
        where: { groupId, status: GroupMemberStatus.ACTIVE },
        select: { account: { select: { name: true, image: true } } },
        orderBy: { joinedAt: 'asc' },
        take: 3,
      }),
    ).catch(() => [] as []),
  ])

  return {
    group: {
      id: group.id,
      name: group.name,
      emoji: group.emoji ?? null,
      color: group.color ?? null,
      currencyCode: group.ledger?.currencyCode ?? null,
    },
    memberCount: count ?? 0,
    memberSample: (sample ?? []).map((member) => ({
      name: member.account?.name ?? null,
      image: member.account?.image ?? null,
    })),
    usable: true,
  }
}
