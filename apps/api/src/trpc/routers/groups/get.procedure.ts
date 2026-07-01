import { GroupInvitationStatus, GroupInvitationType, prisma } from '@spliit/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { getGroup } from '../../../lib/api'
import { hashLinkToken } from '../../../lib/invitations'
import {
  linkInviteTokenInput,
  loadGroupContext,
  protectedProcedure,
} from '../../init'

/**
 * State of the URL-borne link-invite token. The group page surfaces a
 * specific banner (or a "no longer valid" warning) based on this
 * signal.
 *
 *  - `PENDING`   — valid, never used, the Accept/Decline banner is shown
 *  - `ACCEPTED`  — already used (either by the current account, in
 *                  which case they're a member, or by someone else);
 *                  the "already a member" / "no longer valid" banner
 *                  is shown
 *  - `REVOKED`   — admin revoked the link
 *  - `DECLINED`  — recipient declined
 *  - `EXPIRED`   — past the expiry timestamp
 */
export type LinkInviteState =
  'PENDING' | 'ACCEPTED' | 'REVOKED' | 'DECLINED' | 'EXPIRED'

export const getGroupProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      // Optional raw link-invite token from the page URL. Validity is
      // enforced by `loadGroupContext` (for members) and the inline
      // LINK check below (for non-members) against the stored hash, so
      // no client-side format check is needed here.
      linkInviteToken: linkInviteTokenInput,
    }),
  )
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
      const linkInviteState = linkInviteToken
        ? await resolveLinkInviteState(groupId, linkInviteToken)
        : null
      return {
        group,
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
      const group = await getGroup(groupId)
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
        return {
          group,
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
 * Resolve a link-invite token to its current state. Returns `null`
 * when the token does not match any LINK invitation for the group
 * (forged or mistyped links).
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
