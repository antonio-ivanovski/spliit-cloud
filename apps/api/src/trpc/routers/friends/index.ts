import { prisma } from '@spliit/db'
import { friendFormSchema } from '@spliit/domain'
import { z } from 'zod'
import {
  createFriendLedger,
  type CreateFriendLedgerPeer,
} from '../../../lib/api/friends'
import { sendEmail } from '../../../lib/mail/send'
import { renderFriendLedgerEmail } from '../../../lib/mail/templates'
import { createTRPCRouter, protectedProcedure } from '../../init'

/**
 * Send a notification email (not an invitation) when a friend ledger is
 * created. No accept/decline link — the friend ledger auto-appears on
 * next login.
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
  /** Create a friend ledger via one of three modes (account id, email, or shareable link). Exactly one mode must be set on `friendFormValues`. */
  create: protectedProcedure
    .input(z.object({ friendFormValues: friendFormSchema }))
    .mutation(async ({ input: { friendFormValues }, ctx }) => {
      const callerId = ctx.auth.user.id

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

      const result = await createFriendLedger({
        callerAccountId: callerId,
        peer,
        currency: friendFormValues.currency,
        currencyCode: friendFormValues.currencyCode,
        information: friendFormValues.information,
      })

      // Send a notification email (not an invitation with an accept
      // link) when a friend ledger is created. The peer will see it
      // automatically on next login — the email is purely informational.
      if (!result.existed) {
        const inviterName = ctx.auth.user.name || ctx.auth.user.email
        if ('email' in peer) {
          // Email tab: the peer is either an existing account that was
          // resolved (direct-accept) or an unknown email (pending).
          const isNewUser = !!result.invitationId
          await sendFriendLedgerNotification({
            recipientEmail: peer.email,
            inviterName,
            isNewUser,
          })
        } else if ('accountId' in peer) {
          // Friends tab: the peer was selected from the list. Look up
          // their email for the notification.
          const account = await prisma.account.findUnique({
            where: { id: peer.accountId },
            select: { email: true },
          })
          if (account?.email) {
            await sendFriendLedgerNotification({
              recipientEmail: account.email,
              inviterName,
              isNewUser: false, // already has an account
            })
          }
        }
        // Link tab: no email — the inviter shares the link off-channel.
      }

      return result
    }),
})
