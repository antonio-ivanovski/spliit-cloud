import { TRPCError } from '@trpc/server'

import {
  GroupInvitationStatus,
  GroupInvitationType,
  GroupMemberStatus,
  GroupRole,
  GroupType,
  Prisma,
  prisma,
  type Prisma as PrismaType,
} from '@spliit/db'

import { getWebBaseUrl } from '../auth/urls'
import {
  buildLinkPlaceholderEmail,
  generateLinkToken,
  hashLinkToken,
  LINK_INVITATION_DEFAULT_TTL_MS,
  reconcileMemberLedgerParticipant,
} from '../invitations'
import { randomId } from './shared'

type TxClient = PrismaType.TransactionClient

export type CreateFriendLedgerPeer =
  | { accountId: string }
  | { email: string; temporaryName?: string | null }
  | { link: true; temporaryName?: string | null }

export type CreateFriendLedgerArgs = {
  callerAccountId: string
  peer: CreateFriendLedgerPeer
  currency: string
  currencyCode?: string | null
  information?: string | null
  linkToken?: string
}

export type CreateFriendLedgerResult =
  | { groupId: string; existed: true }
  | {
      groupId: string
      existed: false
      invitationId?: string
      inviteUrl?: string
      token?: string
    }

function friendPairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
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

async function removeDuplicatePendingFriendLedger(
  err: DuplicateFriendLedgerError,
): Promise<void> {
  await prisma.group
    .delete({ where: { id: err.groupId } })
    .catch(async (deleteErr) => {
      await prisma.groupInvitation
        .delete({ where: { id: err.invitationId } })
        .catch(() => {})
      console.warn(
        `[friends] failed to remove duplicate friend ledger group ${err.groupId} for pair ${err.pairKey}.`,
        deleteErr,
      )
    })
}

async function findExistingFriendGroupByPair(
  client: TxClient,
  callerAccountId: string,
  peerAccountId: string,
): Promise<string | null> {
  const key = friendPairKey(callerAccountId, peerAccountId)
  const existing = await client.group.findFirst({
    where: { friendPairKey: key, groupType: GroupType.FRIEND },
    select: { id: true },
  })
  return existing?.id ?? null
}

async function findExistingFriendGroupByPendingEmail(
  client: TxClient,
  callerAccountId: string,
  email: string,
): Promise<string | null> {
  const normalizedEmail = email.toLowerCase()
  const member = await client.groupMember.findFirst({
    where: {
      accountId: callerAccountId,
      status: GroupMemberStatus.ACTIVE,
      group: {
        groupType: GroupType.FRIEND,
        invitations: {
          some: {
            type: GroupInvitationType.EMAIL,
            status: GroupInvitationStatus.PENDING,
            email: { equals: normalizedEmail, mode: 'insensitive' },
          },
        },
      },
    },
    select: { groupId: true },
  })
  return member?.groupId ?? null
}

/**
 * Look up a pending FRIEND email group by the peer's account ID. Used as a
 * fallback when the DIRECT path doesn't find a friendPairKey match — the peer
 * may have recently created their account so a PENDING email invite is still
 * sitting from before they signed up.
 */
async function findExistingFriendGroupByPendingEmailViaAccount(
  client: TxClient,
  callerAccountId: string,
  peerAccountId: string,
): Promise<string | null> {
  const account = await client.account.findUnique({
    where: { id: peerAccountId },
    select: { email: true },
  })
  if (!account?.email) return null
  return findExistingFriendGroupByPendingEmail(
    client,
    callerAccountId,
    account.email,
  )
}

/**
 * Create (or rejoin) a friend ledger between the caller and the chosen peer.
 *
 * Three entry paths:
 *
 * - **Direct**: the peer is a known account. The function creates the Group, two
 *   ADMIN/ACTIVE members, two LedgerParticipants, and sets the friendPairKey on
 *   the Group.
 * - **Pending email**: the peer email is not yet an account. The function creates
 *   the Group with caller as the only active member, creates a PENDING EMAIL
 *   invitation (with pre-materialized LedgerParticipant attached), and returns
 *   the new groupId. friendPairKey is null until the peer joins.
 * - **Pending link**: same shape as the pending email path, but the invitation is
 *   a shareable LINK and the caller receives a one-time `inviteUrl` to send to
 *   the peer.
 *
 * When a matching friendPairKey already exists (direct) or a matching pending
 * FRIEND invitation already exists (email/link), the function short-circuits
 * and returns `{ groupId, existed: true }`.
 */
export async function createFriendLedger(
  args: CreateFriendLedgerArgs,
  tx?: TxClient,
): Promise<CreateFriendLedgerResult> {
  const { callerAccountId, peer, currency, currencyCode, information } = args
  // Use the transaction client for all reads when one is provided, so
  // lookups share the same connection as the writes and do not reserve
  // extra pool connections during an interactive transaction.
  const client: TxClient = tx ?? prisma

  const resolvedPeer: CreateFriendLedgerPeer = peer

  if ('accountId' in resolvedPeer) {
    if (resolvedPeer.accountId === callerAccountId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'You cannot create a friend ledger with yourself.',
      })
    }
    let existing = await findExistingFriendGroupByPair(
      client,
      callerAccountId,
      resolvedPeer.accountId,
    )
    if (existing) return { groupId: existing, existed: true }
    // The peer may have already created a friend ledger for THIS pair
    // from their direction (e.g. they created it, the caller signed up
    // later, and auto-accept hasn't run yet). The peer's side has a
    // PENDING EMAIL invite targeting the caller's email. Check that
    // cross-direction path so we don't create a duplicate.
    if (!existing) {
      existing = await findExistingFriendGroupByPendingEmailViaAccount(
        client,
        callerAccountId,
        resolvedPeer.accountId,
      )
      if (existing) return { groupId: existing, existed: true }
    }
    if (!existing) {
      const callerAccount = await client.account.findUnique({
        where: { id: callerAccountId },
        select: { email: true },
      })
      if (callerAccount?.email) {
        existing = await findExistingFriendGroupByPendingEmail(
          client,
          resolvedPeer.accountId,
          callerAccount.email,
        )
        if (existing) return { groupId: existing, existed: true }
      }
    }
  } else if ('email' in resolvedPeer) {
    // The caller is responsible for resolving email → accountId before
    // calling this function. If the peer is still email-shaped, no
    // matching account existed at normalization time. Check only for an
    // existing pending email invitation to avoid duplicates.
    const existing = await findExistingFriendGroupByPendingEmail(
      client,
      callerAccountId,
      resolvedPeer.email,
    )
    if (existing) return { groupId: existing, existed: true }
  }

  const run = async (tx: TxClient) => {
    const ledger = await tx.ledger.create({
      data: {
        id: randomId(),
        currency,
        currencyCode: currencyCode || null,
      },
    })

    const group = await tx.group.create({
      data: {
        id: randomId(),
        name: randomId(),
        information: information ?? null,
        groupType: GroupType.FRIEND,
        ledgerId: ledger.id,
      },
    })

    const callerMember = await tx.groupMember.create({
      data: {
        id: randomId(),
        groupId: group.id,
        accountId: callerAccountId,
        role: GroupRole.ADMIN,
        status: GroupMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
    })

    await tx.ledgerParticipant.create({
      data: {
        id: randomId(),
        ledgerId: ledger.id,
        groupMemberId: callerMember.id,
      },
    })

    if ('accountId' in resolvedPeer) {
      const peerMember = await tx.groupMember.create({
        data: {
          id: randomId(),
          groupId: group.id,
          accountId: resolvedPeer.accountId,
          role: GroupRole.ADMIN,
          status: GroupMemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
      })
      await tx.ledgerParticipant.create({
        data: {
          id: randomId(),
          ledgerId: ledger.id,
          groupMemberId: peerMember.id,
        },
      })
      const key = friendPairKey(callerAccountId, resolvedPeer.accountId)
      await tx.group.update({
        where: { id: group.id },
        data: { friendPairKey: key },
      })
      return { groupId: group.id, existed: false as const }
    }

    const pendingParticipant = await tx.ledgerParticipant.create({
      data: {
        id: randomId(),
        ledgerId: ledger.id,
      },
    })

    if ('email' in resolvedPeer) {
      const invitation = await tx.groupInvitation.create({
        data: {
          id: randomId(),
          type: GroupInvitationType.EMAIL,
          groupId: group.id,
          email: resolvedPeer.email.toLowerCase(),
          role: GroupRole.ADMIN,
          temporaryName: resolvedPeer.temporaryName ?? null,
          invitedById: callerAccountId,
          ledgerParticipantId: pendingParticipant.id,
        },
      })
      return {
        groupId: group.id,
        existed: false as const,
        invitationId: invitation.id,
      }
    }

    const token = args.linkToken ?? generateLinkToken()
    const tokenHash = await hashLinkToken(token)
    const invitation = await tx.groupInvitation.create({
      data: {
        id: randomId(),
        type: GroupInvitationType.LINK,
        groupId: group.id,
        email: buildLinkPlaceholderEmail(token),
        role: GroupRole.ADMIN,
        temporaryName: resolvedPeer.temporaryName ?? null,
        invitedById: callerAccountId,
        tokenHash,
        expiresAt: new Date(Date.now() + LINK_INVITATION_DEFAULT_TTL_MS),
        ledgerParticipantId: pendingParticipant.id,
      },
    })
    const webBase = getWebBaseUrl()
    const inviteUrl = `${webBase}/groups/${group.id}#invite=${token}`
    return {
      groupId: group.id,
      existed: false as const,
      invitationId: invitation.id,
      inviteUrl,
      token,
    }
  }
  if (tx) {
    return run(tx)
  }
  return prisma.$transaction(run)
}

/**
 * Reconcile PENDING email invitations on FRIEND-typed groups for the given
 * account. Called lazily on first authenticated visit (the `account.me` query)
 * so that an account created via better-auth auto-claims any friend ledgers
 * that were opened for the address before the account existed. Each invitation
 * is materialized in its own transaction so one failure does not block the
 * rest.
 */
export async function autoAcceptPendingFriendInvitationsForAccount(opts: {
  accountId: string
  accountEmail: string
}): Promise<void> {
  const { accountId, accountEmail } = opts
  const normalizedEmail = accountEmail.toLowerCase()

  const pending = await prisma.groupInvitation.findMany({
    where: {
      type: GroupInvitationType.EMAIL,
      status: GroupInvitationStatus.PENDING,
      email: { equals: normalizedEmail, mode: 'insensitive' },
      group: { groupType: GroupType.FRIEND },
    },
    select: {
      id: true,
      groupId: true,
      invitedById: true,
      role: true,
      ledgerParticipantId: true,
    },
  })

  if (pending.length === 0) return

  for (const invitation of pending) {
    await prisma
      .$transaction(async (tx) => {
        const flipped = await tx.groupInvitation.updateMany({
          where: {
            id: invitation.id,
            status: GroupInvitationStatus.PENDING,
          },
          data: {
            status: GroupInvitationStatus.ACCEPTED,
            acceptedById: accountId,
            acceptedAt: new Date(),
          },
        })
        if (flipped.count === 0) return

        const group = await tx.group.findUnique({
          where: { id: invitation.groupId },
          select: { ledgerId: true },
        })
        if (!group?.ledgerId) return

        const member = await tx.groupMember.upsert({
          where: {
            groupId_accountId: {
              groupId: invitation.groupId,
              accountId,
            },
          },
          create: {
            id: randomId(),
            groupId: invitation.groupId,
            accountId,
            role: invitation.role,
            status: GroupMemberStatus.ACTIVE,
            joinedAt: new Date(),
          },
          update: {
            role: invitation.role,
            status: GroupMemberStatus.ACTIVE,
            joinedAt: new Date(),
            leftAt: null,
          },
        })

        const existingParticipant = await tx.ledgerParticipant.findUnique({
          where: { groupMemberId: member.id },
          select: { id: true },
        })
        if (!existingParticipant) {
          await reconcileMemberLedgerParticipant(tx, {
            memberId: member.id,
            ledgerId: group.ledgerId,
            pendingParticipantId: invitation.ledgerParticipantId,
          })
        }

        const pairKey = friendPairKey(accountId, invitation.invitedById)
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
      })
      .catch((err) => {
        if (err instanceof DuplicateFriendLedgerError) {
          console.warn(
            `[friends] duplicate friend ledger detected while auto-accepting invitation ${err.invitationId}; removing stale group ${err.groupId}.`,
            err,
          )
          return removeDuplicatePendingFriendLedger(err)
        }
        console.error(
          `[friends] failed to auto-accept pending friend invitation ${invitation.id} for account ${accountId}. ` +
            `Group: ${invitation.groupId}, InvitedBy: ${invitation.invitedById}.`,
          err instanceof Error ? err.stack : err,
        )
      })
  }
}
