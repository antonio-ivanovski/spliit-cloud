import { TRPCError } from '@trpc/server'

import {
  GroupInvitationStatus,
  GroupInvitationType,
  GroupMemberStatus,
  GroupType,
  Prisma,
  prisma,
  type GroupRole,
  type Prisma as PrismaTypes,
} from '@spliit/db'
import type { SpliitBoss } from '@spliit/jobs'

import {
  buildInvitationActivityData,
  logActivity,
  planNotificationForActivity,
} from '../api/activities'
import { getApiBoss } from '../api/boss'
import { randomId } from '../api/shared'
import { getWebBaseUrl } from '../auth/urls'
import { assertInvitationRouteIdDoesNotMatchGroup } from '../group-route'
import { buildLinkPlaceholderEmail, getInvitationDisplayName } from './display'
import { findPendingEmailInvitation } from './email-invitations'
import {
  materializePendingInvitationParticipant,
  reconcileMemberLedgerParticipant,
} from './ledger-reconciliation'

export class InvitationError extends TRPCError {
  constructor(message: string) {
    super({ code: 'BAD_REQUEST', message })
  }
}

class DuplicateFriendLedgerError extends Error {
  constructor(
    readonly invitationId: string,
    readonly groupId: string,
    readonly pairKey: string,
  ) {
    super('Duplicate friend ledger')
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  )
}

async function removeDuplicateFriendLinkInvitation(
  err: DuplicateFriendLedgerError,
): Promise<void> {
  await prisma.group
    .delete({ where: { id: err.groupId } })
    .catch(async (deleteErr) => {
      await prisma.groupInvitation
        .delete({ where: { id: err.invitationId } })
        .catch(() => {})
      console.warn(
        `[friends] failed to remove duplicate friend link group ${err.groupId} for pair ${err.pairKey}.`,
        deleteErr,
      )
    })
}

/** Default expiry for link invitations. 30 days. */
export const LINK_INVITATION_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Generate a high-entropy, URL-safe raw token for a new link invitation. */
export function generateLinkToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

/** SHA-256 hash of a link token. */
export async function hashLinkToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function resolveLinkExpiresAt(expiresAt: Date | null | undefined): Date {
  if (expiresAt) return expiresAt
  return new Date(Date.now() + LINK_INVITATION_DEFAULT_TTL_MS)
}

export type CreateLinkInvitationInput = {
  groupId: string
  role: GroupRole
  inviterAccountId: string
  temporaryName?: string | null
  expiresAt?: Date | null
  ledgerParticipantId?: string | null
  notificationBoss?: SpliitBoss | null
  token?: string
  tx?: PrismaTypes.TransactionClient
}

export type CreateLinkInvitationResult = {
  invitation: {
    id: string
    groupId: string
    role: GroupRole
    temporaryName: string | null
    expiresAt: Date
  }
  token: string
  inviteUrl: string
}

/** Create a link invitation. */
export async function createLinkInvitation(
  input: CreateLinkInvitationInput,
): Promise<CreateLinkInvitationResult> {
  const token = input.token ?? generateLinkToken()
  const tokenHash = await hashLinkToken(token)
  const expiresAt = resolveLinkExpiresAt(input.expiresAt)
  const webBase = getWebBaseUrl()
  const boss =
    input.notificationBoss !== undefined
      ? input.notificationBoss
      : await getApiBoss()

  const run = async (tx: PrismaTypes.TransactionClient) => {
    await assertInvitationRouteIdDoesNotMatchGroup(token, tx)
    const participantId = await materializePendingInvitationParticipant(tx, {
      groupId: input.groupId,
      suppliedParticipantId: input.ledgerParticipantId,
      displayName: input.temporaryName,
    })

    const inv = await tx.groupInvitation.create({
      data: {
        id: randomId(),
        type: GroupInvitationType.LINK,
        groupId: input.groupId,
        email: buildLinkPlaceholderEmail(token),
        role: input.role,
        temporaryName: input.temporaryName ?? null,
        invitedById: input.inviterAccountId,
        tokenHash,
        expiresAt,
        ledgerParticipantId: participantId,
      },
    })

    const activity = await logActivity(
      inv.groupId,
      {
        type: 'INVITATION_CREATED',
        actor: { type: 'ACCOUNT', id: input.inviterAccountId },
        subject: { type: 'INVITATION', id: inv.id },
        data: buildInvitationActivityData({
          displayLabel: getInvitationDisplayName(inv),
          invitationType: 'LINK',
          role: input.role,
        }),
      },
      tx,
    )

    await planNotificationForActivity(tx, activity, {}, { boss })
    return inv
  }
  const invitation = input.tx
    ? await run(input.tx)
    : await prisma.$transaction(run)
  return {
    invitation: {
      id: invitation.id,
      groupId: invitation.groupId,
      role: invitation.role,
      temporaryName: invitation.temporaryName,
      expiresAt: invitation.expiresAt!,
    },
    token,
    inviteUrl: `${webBase}/groups/${token}`,
  }
}

export type LinkInvitationPreview = {
  group: { id: string; name: string }
  inviter: { name: string }
  temporaryName: string | null
  role: GroupRole
  usable: boolean
  reason: 'revoked' | 'declined' | 'accepted' | 'expired' | 'unknown' | null
  expiresAt: Date | null
}

/** Public-safe preview of a link invitation, looked up by the raw token. */
export async function getLinkInvitationPreview(
  token: string,
): Promise<LinkInvitationPreview | null> {
  const tokenHash = await hashLinkToken(token)
  return getLinkInvitationPreviewByHash(tokenHash)
}

async function getLinkInvitationPreviewByHash(
  tokenHash: string,
): Promise<LinkInvitationPreview | null> {
  const invitation = await prisma.groupInvitation.findFirst({
    where: { tokenHash },
    select: {
      status: true,
      expiresAt: true,
      temporaryName: true,
      role: true,
      group: { select: { id: true, name: true, groupType: true } },
      invitedBy: { select: { name: true } },
    },
  })
  if (!invitation) return null

  let reason: LinkInvitationPreview['reason'] = null
  let usable = invitation.status === GroupInvitationStatus.PENDING
  if (!usable) {
    if (invitation.status === GroupInvitationStatus.REVOKED) reason = 'revoked'
    else if (invitation.status === GroupInvitationStatus.DECLINED)
      reason = 'declined'
    else if (invitation.status === GroupInvitationStatus.ACCEPTED)
      reason = 'accepted'
    else reason = 'unknown'
  } else if (invitation.expiresAt && invitation.expiresAt < new Date()) {
    usable = false
    reason = 'expired'
  }

  const inviterName = invitation.invitedBy?.name ?? ''
  const groupName =
    invitation.group.groupType === GroupType.FRIEND
      ? `Friend ledger with ${inviterName || 'someone'}`
      : invitation.group.name

  return {
    group: { id: invitation.group.id, name: groupName },
    inviter: { name: inviterName },
    temporaryName: invitation.temporaryName,
    role: invitation.role,
    usable,
    reason,
    expiresAt: invitation.expiresAt ?? null,
  }
}

/** Accept a link invitation for the current account. */
export async function acceptLinkInvitation(
  opts: {
    accountId: string
  } & ({ token: string } | { tokenHash: string }),
) {
  const tokenHash =
    'tokenHash' in opts ? opts.tokenHash : await hashLinkToken(opts.token)
  const preview = await getLinkInvitationPreviewByHash(tokenHash)
  if (!preview) {
    throw new InvitationError('Invitation not found.')
  }
  if (!preview.usable) {
    const reason =
      preview.reason === 'expired'
        ? 'This invitation link has expired.'
        : preview.reason === 'revoked'
          ? 'This invitation link was revoked by an admin.'
          : preview.reason === 'declined'
            ? 'This invitation link was declined.'
            : preview.reason === 'accepted'
              ? 'This invitation link has already been used.'
              : 'This invitation link is no longer valid.'
    throw new InvitationError(reason)
  }

  const existingMember = await prisma.groupMember.findFirst({
    where: {
      groupId: preview.group.id,
      accountId: opts.accountId,
      status: GroupMemberStatus.ACTIVE,
    },
    select: { id: true },
  })
  if (existingMember) {
    throw new InvitationError(
      'You are already a member of this group. Open the group from your list instead.',
    )
  }

  // A pending EMAIL invitation for the account's email takes
  // precedence over the link: redeeming the link would join through
  // the wrong invitation (and its ledger participant), orphaning the
  // email invite. The email invitation is the recipient-specific
  // intent, so surface it instead of accepting via the link.
  const account = await prisma.account.findUnique({
    where: { id: opts.accountId },
    select: { email: true },
  })
  if (account?.email) {
    const pendingEmailInvitation = await findPendingEmailInvitation(
      preview.group.id,
      account.email,
    )
    if (pendingEmailInvitation) {
      throw new InvitationError(
        'You already have a personal email invitation to this group. Open it from your invitations instead of using this link.',
      )
    }
  }

  const boss = await getApiBoss()
  const result = await prisma
    .$transaction(async (tx) => {
      const flipped = await tx.groupInvitation.updateMany({
        where: {
          tokenHash,
          status: GroupInvitationStatus.PENDING,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        data: {
          status: GroupInvitationStatus.ACCEPTED,
          acceptedById: opts.accountId,
          acceptedAt: new Date(),
        },
      })
      if (flipped.count === 0) {
        throw new InvitationError('This invitation link is no longer valid.')
      }

      const invitation = await tx.groupInvitation.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          groupId: true,
          role: true,
          invitedById: true,
          email: true,
          temporaryName: true,
          ledgerParticipantId: true,
          group: {
            select: {
              groupType: true,
              ledger: { select: { id: true } },
            },
          },
        },
      })
      if (!invitation || !invitation.group.ledger) {
        throw new InvitationError('Invitation is missing its group ledger.')
      }

      const member = await tx.groupMember.upsert({
        where: {
          groupId_accountId: {
            groupId: invitation.groupId,
            accountId: opts.accountId,
          },
        },
        create: {
          id: randomId(),
          groupId: invitation.groupId,
          accountId: opts.accountId,
          role: invitation.role,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
        update: {
          role: invitation.role,
          status: 'ACTIVE',
          joinedAt: new Date(),
          leftAt: null,
        },
        select: { id: true },
      })

      if (invitation.group.groupType === GroupType.FRIEND) {
        const pairKey = [opts.accountId, invitation.invitedById]
          .sort()
          .join(':')
        try {
          await tx.group.update({
            where: { id: invitation.groupId },
            data: { friendPairKey: pairKey },
          })
        } catch (err) {
          if (isUniqueConstraintError(err)) {
            throw new DuplicateFriendLedgerError(
              invitation.id,
              invitation.groupId,
              pairKey,
            )
          }
          throw err
        }
      }

      await reconcileMemberLedgerParticipant(tx, {
        memberId: member.id,
        ledgerId: invitation.group.ledger.id,
        pendingParticipantId: invitation.ledgerParticipantId,
      })

      const activity = await logActivity(
        invitation.groupId,
        {
          type: 'INVITATION_ACCEPTED',
          actor: { type: 'ACCOUNT', id: opts.accountId },
          subject: { type: 'INVITATION', id: invitation.id },
          data: buildInvitationActivityData({
            displayLabel: getInvitationDisplayName(invitation),
          }),
        },
        tx,
      )

      await planNotificationForActivity(tx, activity, {}, { boss })

      return {
        groupId: invitation.groupId,
        role: invitation.role,
        invitationId: invitation.id,
        activity,
      }
    })
    .catch(async (err) => {
      if (err instanceof DuplicateFriendLedgerError) {
        console.warn(
          `[friends] duplicate friend ledger detected while accepting link invitation ${err.invitationId}; removing stale group ${err.groupId}.`,
          err,
        )
        await removeDuplicateFriendLinkInvitation(err)
        throw new InvitationError('A friend ledger already exists.')
      }
      throw err
    })

  return { groupId: result.groupId, role: result.role }
}
