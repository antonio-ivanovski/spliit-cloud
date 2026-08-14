import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { GroupType } from '@spliit/db'

import { getGroup } from '../../../lib/api/groups'
import { redactViewerDisplayName } from '../../../lib/group-view'
import { redactGroupForViewer } from '../../../lib/group-view-redaction'
import { getInvitationDisplayName } from '../../../lib/invitations/display'
import { acceptLinkInvitation } from '../../../lib/invitations/link-invitations'
import {
  groupReadProcedure,
  loadGroupMutationContext,
  loadGroupViewer,
} from '../../init'
import { getGroupOutputSchema } from '../../outputs/groups'

export type LinkInviteState =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REVOKED'
  | 'DECLINED'
  | 'EXPIRED'

export const getGroupProcedure = groupReadProcedure
  .input(z.object({ groupId: z.string().min(1) }))
  .output(getGroupOutputSchema)
  .query(async ({ input, ctx }) => {
    const account = ctx.auth?.user
    let access = await loadGroupViewer({
      groupId: input.groupId,
      accountId: account?.id,
      accountEmail: account?.email,
    })

    if (
      account &&
      access.routeSource === 'INVITATION' &&
      access.group.groupType === GroupType.FRIEND &&
      access.viewer.kind === 'PENDING_INVITEE'
    ) {
      try {
        await acceptLinkInvitation({
          token: input.groupId,
          accountId: account.id,
        })
        access = await loadGroupViewer({
          groupId: input.groupId,
          accountId: account.id,
          accountEmail: account.email,
        })
      } catch {
        // A concurrent request may have consumed or revoked the invitation.
        // The follow-up authorization below remains the source of truth.
      }
    }

    const group = await getGroup(access.canonicalGroupId)
    if (!group) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Group access denied' })
    }

    if (access.viewer.kind === 'ACTIVE' && account) {
      const { member } = await loadGroupMutationContext({
        groupId: access.canonicalGroupId,
        accountId: account.id,
      })
      return {
        group,
        canonicalGroupId: access.canonicalGroupId,
        displayName: resolveDisplayName(group, account.id),
        currentLedgerParticipantId: member.ledgerParticipant?.id ?? null,
        currentMember: {
          id: member.id,
          role: member.role,
          status: member.status,
        },
        currentInvitation: null,
        linkInviteState: null,
        viewer: {
          source: 'MEMBER' as const,
          access: 'READ_WRITE' as const,
          canMutate: true,
          canAcceptInvitation: false,
        },
      }
    }

    const invitation =
      access.viewer.kind === 'PENDING_INVITEE' ? access.viewer.invitation : null
    const shouldRedact = !account || access.viewer.kind === 'PUBLIC_VIEW'
    const displayName = resolveDisplayName(group, account?.id ?? '')

    return {
      group: shouldRedact ? redactGroupForViewer(group) : group,
      canonicalGroupId: access.canonicalGroupId,
      displayName: shouldRedact
        ? redactViewerDisplayName(displayName)
        : displayName,
      currentLedgerParticipantId: null,
      currentMember: null,
      currentInvitation: invitation,
      linkInviteState:
        invitation?.type === 'LINK' ? ('PENDING' as const) : null,
      viewer: {
        source:
          access.viewer.kind === 'PUBLIC_VIEW'
            ? ('PUBLIC_LINK' as const)
            : ('PENDING_INVITATION' as const),
        access: 'READ_ONLY' as const,
        canMutate: false,
        canAcceptInvitation: invitation != null,
      },
    }
  })

/**
 * Compute a human-readable display name for the group. For FRIEND-typed groups
 * whose `name` is always empty, resolve the name from the peer active member's
 * account, a pending invitation's temporary name, or the invitation display
 * label. For regular groups, returns the stored name.
 */
function resolveDisplayName(
  group: NonNullable<Awaited<ReturnType<typeof getGroup>>>,
  viewerAccountId: string,
): string {
  if (group.groupType !== GroupType.FRIEND) return group.name
  const peerMember = group.members.find((m) => m.accountId !== viewerAccountId)
  if (peerMember?.account.name) return peerMember.account.name
  const pendingInv = group.invitations[0]
  if (pendingInv?.temporaryName) return pendingInv.temporaryName
  if (pendingInv?.email) return getInvitationDisplayName(pendingInv)
  return ''
}
