import { createHash } from 'node:crypto'

import type { getGroup } from './api/groups'
import { redactViewerDisplayName } from './group-view'

function publicId(groupId: string, kind: string, id: string) {
  return `public_${createHash('sha256')
    .update(groupId)
    .update('\0')
    .update(kind)
    .update('\0')
    .update(id)
    .digest('base64url')
    .slice(0, 22)}`
}

/** Remove contact fields and invitation metadata from read-only group payloads. */
export function redactGroupForViewer(
  group: NonNullable<Awaited<ReturnType<typeof getGroup>>>,
) {
  const memberIds = new Map(
    group.members.map((member) => [
      member.id,
      publicId(group.id, 'member', member.id),
    ]),
  )
  return {
    ...group,
    friendPairKey: null,
    invitations: [],
    members: group.members.map((member) => ({
      ...member,
      id: memberIds.get(member.id)!,
      accountId: publicId(group.id, 'account', member.accountId),
      account: {
        id: publicId(group.id, 'account', member.account.id),
        name: member.account.name,
        image: null,
      },
      ledgerParticipant: member.ledgerParticipant
        ? {
            ...member.ledgerParticipant,
            groupMemberId: memberIds.get(member.id)!,
          }
        : null,
    })),
    participants: group.participants.map((participant) => ({
      ...participant,
      name: redactViewerDisplayName(participant.name),
      account: participant.account
        ? {
            id: publicId(group.id, 'account', participant.account.id),
            name: participant.account.name,
            image: null,
          }
        : null,
    })),
  }
}
