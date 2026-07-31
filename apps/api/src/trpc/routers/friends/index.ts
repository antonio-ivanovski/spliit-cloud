import { z } from 'zod'

import { prisma } from '@spliit/db'
import { friendFormSchema } from '@spliit/domain'
import { NotificationCategory } from '@spliit/domain/notifications'

import { getApiBoss } from '../../../lib/api/boss'
import {
  createFriendLedger,
  type CreateFriendLedgerPeer,
} from '../../../lib/api/friends'
import { getPlaceholderEmailDisplayName } from '../../../lib/invitations/display'
import { sendEmail } from '../../../lib/mail/send'
import { renderFriendLedgerEmail } from '../../../lib/mail/templates/friend-ledger'
import { planActivityNotificationDeliveries } from '../../../lib/notifications/delivery-planner'
import { createTRPCRouter, protectedProcedure } from '../../init'

/**
 * Send a notification email (not an invitation) when a friend ledger is
 * created. No accept/decline link — the friend ledger auto-appears on next
 * login.
 */
async function sendFriendLedgerNotification(opts: {
  recipientEmail: string
  inviterName: string
  isNewUser: boolean
}): Promise<void> {
  try {
    const rendered = await renderFriendLedgerEmail({
      inviterName: opts.inviterName,
      isNewUser: opts.isNewUser,
    })
    await sendEmail({ to: opts.recipientEmail, ...rendered })
  } catch (err) {
    console.warn(
      `[friends] failed to send friend ledger notification to ${opts.recipientEmail}:`,
      err,
    )
  }
}

export const friendsRouter = createTRPCRouter({
  /**
   * Create a friend ledger via one of three modes (account id, email, or
   * shareable link). Exactly one mode must be set on `friendFormValues`.
   */
  create: protectedProcedure
    .input(z.object({ friendFormValues: friendFormSchema }))
    .output(
      z.object({
        groupId: z.string(),
        existed: z.boolean(),
        invitationId: z.string().optional(),
        inviteUrl: z.string().url().optional(),
        token: z.string().optional(),
      }),
    )
    .mutation(async ({ input: { friendFormValues }, ctx }) => {
      const callerId = ctx.auth.user.id

      // Normalize the peer exactly once, before resolving pg-boss. If the
      // email maps to an existing account the peer becomes account-backed
      // and durable notification planning is required. If the account
      // appears after this read, treating the peer as a pending email
      // invitation is acceptable — auto-accept reconciles it later.
      let peer: CreateFriendLedgerPeer
      if (friendFormValues.peerAccountId) {
        peer = { accountId: friendFormValues.peerAccountId }
      } else if (friendFormValues.peerEmail) {
        const account = await prisma.account.findUnique({
          where: { email: friendFormValues.peerEmail.toLowerCase() },
          select: { id: true },
        })
        if (account) {
          peer = { accountId: account.id }
        } else {
          peer = {
            email: friendFormValues.peerEmail,
            temporaryName: friendFormValues.temporaryName ?? null,
          }
        }
      } else if (friendFormValues.useLink) {
        peer = {
          link: true,
          temporaryName: friendFormValues.temporaryName ?? null,
        }
      } else {
        peer = { link: true }
      }

      // Resolve the boss client only for account-backed peers that will
      // receive a durable notification. Email and link paths never call
      // the planner, so they must not depend on queue availability.
      const boss = 'accountId' in peer ? await getApiBoss() : null
      const result = await prisma.$transaction(async (tx) => {
        const ledgerResult = await createFriendLedger(
          {
            callerAccountId: callerId,
            peer,
            currency: friendFormValues.currency,
            currencyCode: friendFormValues.currencyCode,
            information: friendFormValues.information,
          },
          tx,
        )

        if (!ledgerResult.existed && 'accountId' in peer) {
          const inviterName =
            ctx.auth.user.name ||
            getPlaceholderEmailDisplayName(ctx.auth.user.email) ||
            ctx.auth.user.email
          await planActivityNotificationDeliveries({
            event: {
              activityId: null,
              type: 'INVITATION_CREATED',
              groupId: ledgerResult.groupId,
              actor: { type: 'ACCOUNT', id: callerId },
              subject: null,
              data: {
                kind: 'invitation',
                summary: `${inviterName} created a friend ledger with you`,
              },
              occurredAt: new Date(),
              notificationCategory: NotificationCategory.FRIEND_ADDED,
              recipientAccountId: peer.accountId,
              customEventKey: `friend:${ledgerResult.groupId}:${peer.accountId}`,
            },
            tx,
            boss,
          })
        }

        return ledgerResult
      })

      // Send a notification email (not an invitation with an accept
      // link) when a friend ledger is created. The peer will see it
      // automatically on next login — the email is purely informational.
      if (!result.existed && 'email' in peer) {
        const inviterName =
          ctx.auth.user.name ||
          getPlaceholderEmailDisplayName(ctx.auth.user.email) ||
          ctx.auth.user.email
        const isNewUser = !!result.invitationId
        await sendFriendLedgerNotification({
          recipientEmail: peer.email,
          inviterName,
          isNewUser,
        })
      }
      // Link tab: no email — the inviter shares the link off-channel.

      return result
    }),
})
