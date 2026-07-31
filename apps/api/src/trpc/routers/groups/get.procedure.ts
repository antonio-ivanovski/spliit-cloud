import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import {
  GroupInvitationStatus,
  GroupInvitationType,
  GroupType,
  prisma,
} from '@spliit/db'

import { getGroup } from '../../../lib/api'
import {
  acceptLinkInvitation,
  getInvitationDisplayName,
  hashLinkToken,
} from '../../../lib/invitations'
import {
  linkInviteTokenInput,
  loadGroupContext,
  protectedProcedure,
} from '../../init'
import { getGroupOutputSchema } from '../../outputs/groups'

/**
 * State of the URL-borne link-invite token. The group page surfaces a specific
 * banner (or a "no longer valid" warning) based on this signal.
 *
 * - `PENDING` — valid, never used, the Accept/Decline banner is shown
 * - `ACCEPTED` — already used (either by the current account, in which case
 *   they're a member, or by someone else); the "already a member" / "no longer
 *   valid" banner is shown
 * - `REVOKED` — admin revoked the link
 * - `DECLINED` — recipient declined
 * - `EXPIRED` — past the expiry timestamp
 */
export type LinkInviteState =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REVOKED'
  | 'DECLINED'
  | 'EXPIRED'

export const getGroupProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      // Optional raw link-invite token from the page URL. Validity is
      // enforced by `loadGroupContext` (for members) and the inline
      // LINK check below (for non-members) against the stored hash, so
      // no client-side format check is needed here.
      linkInviteToken: linkInviteTokenInput.describe(
        'Raw link-invite token from the share URL. Grants read access to pending link-invitees.',
      ),
    }),
  )
  .output(getGroupOutputSchema)
  .query(async ({ input: { groupId, linkInviteToken }, ctx }) => {
    const account = ctx.auth.user

    // Distinguish "group does not exist" from "you are not a member":
    // the web layout uses NOT_FOUND to trigger the import hand-off
    // (see `groups.lookup`), while FORBIDDEN stays the standard
    // "not a member" signal.
    const groupExists = await prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true },
    })
    if (!groupExists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
    }

    // Active members get the full payload. If they also carry a link
    // token, look it up so we can tell them whether the link is
    // still usable (typically it isn't — they're already in).
    const memberLookup = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId: account.id } },
      include: { ledgerParticipant: true },
    })
    const isActiveMember = !!memberLookup && memberLookup.status === 'ACTIVE'

    if (isActiveMember) {
      const { member } = await loadGroupContext({
        groupId,
        accountId: account.id,
      })
      const group = await getGroup(groupId)
      if (!group) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
      }
      const displayName = resolveDisplayName(group, account.id)
      const linkInviteState = linkInviteToken
        ? await resolveLinkInviteState(groupId, linkInviteToken)
        : null
      return {
        group,
        displayName,
        currentLedgerParticipantId: member.ledgerParticipant?.id ?? null,
        currentMember: {
          id: member.id,
          role: member.role,
          status: member.status,
        },
        currentInvitation: null,
        linkInviteState,
      }
    }

    // Non-member path. A URL-borne link token is the strongest
    // credential: it grants a read-only viewer regardless of email
    // match. The link's status drives the banner UI.
    if (linkInviteToken) {
      const linkInviteState = await resolveLinkInviteState(
        groupId,
        linkInviteToken,
      )
      if (!linkInviteState) {
        // The token didn't match any LINK invitation for this group.
        // Treat it as a forged / mistyped link rather than a
        // permission failure.
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This invite link is not valid for this group.',
        })
      }

      // For FRIEND groups with a valid PENDING link token, auto-accept
      // the invitation immediately — no Accept/Decline banner. This
      // way the link owner shares it off-channel and the recipient
      // lands directly in the group.
      if (linkInviteState === 'PENDING') {
        const groupTypeResult = await prisma.group.findUnique({
          where: { id: groupId },
          select: { groupType: true },
        })
        if (groupTypeResult?.groupType === GroupType.FRIEND) {
          try {
            await acceptLinkInvitation({
              token: linkInviteToken,
              accountId: account.id,
            })
          } catch {
            // Race: another request accepted first or the invitation
            // state changed underneath us. Fall through to the normal
            // flow which surfaces the current state via the banner.
          }
          // Re-check membership after auto-accept. If the user is now
          // a member, return the full group context like the
          // isActiveMember branch.
          const memberLookupRetry = await prisma.groupMember.findUnique({
            where: {
              groupId_accountId: { groupId, accountId: account.id },
            },
            include: { ledgerParticipant: true },
          })
          if (memberLookupRetry && memberLookupRetry.status === 'ACTIVE') {
            const { member } = await loadGroupContext({
              groupId,
              accountId: account.id,
            })
            const group = await getGroup(groupId)
            if (!group) {
              throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Group not found',
              })
            }
            const displayName = resolveDisplayName(group, account.id)
            return {
              group,
              displayName,
              currentLedgerParticipantId: member.ledgerParticipant?.id ?? null,
              currentMember: {
                id: member.id,
                role: member.role,
                status: member.status,
              },
              currentInvitation: null,
              linkInviteState: 'ACCEPTED' as const,
            }
          }
        }
      }
      const group = await getGroup(groupId)
      if (!group) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
      }
      const displayName = resolveDisplayName(group, account.id)
      const linkRow = await prisma.groupInvitation.findFirst({
        where: {
          groupId,
          type: GroupInvitationType.LINK,
          tokenHash: await hashLinkToken(linkInviteToken),
        },
        select: { id: true, role: true, type: true, status: true },
      })
      return {
        group,
        displayName,
        currentLedgerParticipantId: null,
        currentMember: null,
        currentInvitation:
          linkInviteState === 'PENDING' && linkRow
            ? {
                id: linkRow.id,
                role: linkRow.role,
                type: linkRow.type,
              }
            : null,
        linkInviteState,
      }
    }

    // No link token: fall back to a PENDING email invitation matching
    // the account email. Skipped when the account has no email
    // (forward-compat with email-less accounts).
    if (account.email) {
      const invitation = await prisma.groupInvitation.findFirst({
        where: {
          groupId,
          type: GroupInvitationType.EMAIL,
          status: GroupInvitationStatus.PENDING,
          email: { equals: account.email, mode: 'insensitive' },
        },
        select: { id: true, role: true, type: true },
      })
      if (invitation) {
        const group = await getGroup(groupId)
        if (!group) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
        }
        const displayName = resolveDisplayName(group, account.id)
        return {
          group,
          displayName,
          currentLedgerParticipantId: null,
          currentMember: null,
          currentInvitation: {
            id: invitation.id,
            role: invitation.role,
            type: invitation.type,
          },
          linkInviteState: null,
        }
      }
    }

    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not an active member of this group',
    })
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

/**
 * Resolve a link-invite token to its current state. Returns `null` when the
 * token does not match any LINK invitation for the group (forged or mistyped
 * links).
 */
async function resolveLinkInviteState(
  groupId: string,
  linkInviteToken: string,
): Promise<LinkInviteState | null> {
  const tokenHash = await hashLinkToken(linkInviteToken)
  const row = await prisma.groupInvitation.findFirst({
    where: { groupId, type: GroupInvitationType.LINK, tokenHash },
    select: { status: true, expiresAt: true },
  })
  if (!row) return null
  if (row.status === GroupInvitationStatus.PENDING) {
    if (row.expiresAt && row.expiresAt < new Date()) return 'EXPIRED'
    return 'PENDING'
  }
  if (row.status === GroupInvitationStatus.ACCEPTED) return 'ACCEPTED'
  if (row.status === GroupInvitationStatus.REVOKED) return 'REVOKED'
  if (row.status === GroupInvitationStatus.DECLINED) return 'DECLINED'
  return null
}
