import { prisma } from '@spliit/db'
import { parseActivityData } from '@spliit/domain/activities'
import {
  NotificationCategory,
  NotificationCategoryFamily,
  getNotificationCategoryForActivity,
  notificationCategoryFamily,
} from '@spliit/domain/notifications'
import { getWebBaseUrl } from '../auth/urls'
import { isPlaceholderEmail } from '../invitations/display'
import { sendEmail } from '../mail/send'
import { renderFriendLedgerEmail } from '../mail/templates/friend-ledger'
import { renderGroupActivityEmail } from '../mail/templates/group-activity'
import { renderInvitationEmail } from '../mail/templates/invitation'
import type {
  ActivityNotificationChannelDispatcher,
  ActivityNotificationIntent,
} from './types'
import { buildEmailUnsubscribeMetadata } from './unsubscribe'

const labels: Record<string, string> = {
  GROUP_UPDATED: 'Group details were updated',
  GROUP_ARCHIVED: 'Group was archived',
  GROUP_UNARCHIVED: 'Group was unarchived',
  INVITATION_REVOKED: 'An invitation was revoked',
  INVITATION_ACCEPTED: 'An invitation was accepted',
  INVITATION_DECLINED: 'An invitation was declined',
  MEMBER_LEFT: 'A member left the group',
  MEMBER_REMOVED: 'A member was removed from the group',
  MEMBER_ROLE_CHANGED: 'A member role changed',
}

function customerFacingSummary(summary: string | undefined) {
  if (!summary) return undefined
  return /^[a-z][a-z-]*(?::[a-z-]+)+$/.test(summary) ? undefined : summary
}

function appendHtmlFooter(html: string, footer: string): string {
  const bodyEnd = html.lastIndexOf('</body>')
  if (bodyEnd < 0) return `${html}${footer}`
  return `${html.slice(0, bodyEnd)}${footer}${html.slice(bodyEnd)}`
}

export class GroupEmailActivityNotificationDispatcher implements ActivityNotificationChannelDispatcher {
  async dispatch(intent: ActivityNotificationIntent): Promise<void> {
    if (
      (intent.activity.notificationCategory ??
        getNotificationCategoryForActivity(intent.activity.type)) !==
      intent.category
    )
      return
    if (
      notificationCategoryFamily[intent.category] !==
      NotificationCategoryFamily.GROUP
    )
      return
    const [account, group, actor, invitation, inviterMembership] =
      await Promise.all([
        prisma.account.findUnique({
          where: { id: intent.recipientAccountId },
          select: { email: true },
        }),
        prisma.group.findUnique({
          where: { id: intent.activity.groupId },
          select: { name: true },
        }),
        intent.activity.actor?.type === 'ACCOUNT'
          ? prisma.account.findUnique({
              where: { id: intent.activity.actor.id },
              select: { name: true },
            })
          : Promise.resolve(null),
        intent.activity.type === 'INVITATION_CREATED' &&
        intent.activity.subject?.id
          ? prisma.groupInvitation.findUnique({
              where: { id: intent.activity.subject.id },
              select: { temporaryName: true },
            })
          : Promise.resolve(null),
        intent.activity.type === 'INVITATION_CREATED' &&
        intent.activity.actor?.type === 'ACCOUNT'
          ? prisma.groupMember.findFirst({
              where: {
                groupId: intent.activity.groupId,
                accountId: intent.activity.actor.id,
                status: 'ACTIVE',
              },
              select: { role: true },
            })
          : Promise.resolve(null),
      ])
    if (!account?.email || isPlaceholderEmail(account.email) || !group) return
    if (
      intent.activity.type === 'INVITATION_CREATED' &&
      intent.category === NotificationCategory.GROUP_INVITE_RECEIVED &&
      (!intent.activity.subject?.id || !invitation)
    )
      return
    const parsed = parseActivityData(intent.activity.data)
    const summary = customerFacingSummary(
      parsed && 'summary' in parsed ? parsed.summary : undefined,
    )
    const isFriendAdded = intent.category === NotificationCategory.FRIEND_ADDED
    const label = isFriendAdded
      ? 'New friend ledger'
      : (labels[intent.activity.type] ?? 'Group activity')
    const actorName = actor?.name ?? 'Someone'
    const text = isFriendAdded
      ? `${actorName} created a friend ledger with you on Spliit Cloud.${summary ? `\n\n${summary}` : ''}\n\nOpen Spliit Cloud to view your friend ledger:\n${getWebBaseUrl()}`
      : `${label} in ${group.name} by ${actorName}.${summary ? `\n\n${summary}` : ''}\n\nView the group here:\n${getWebBaseUrl()}/groups/${intent.activity.groupId}`
    const unsubscribe = await buildEmailUnsubscribeMetadata({
      accountId: intent.recipientAccountId,
      category:
        intent.activity.notificationCategory ??
        getNotificationCategoryForActivity(intent.activity.type)!,
    })
    try {
      const renderedInvitation =
        intent.activity.type === 'INVITATION_CREATED' &&
        intent.activity.subject?.id
          ? await renderInvitationEmail({
              invitationId: intent.activity.subject.id,
              groupId: intent.activity.groupId,
              groupName: group.name,
              inviterDisplayName: actorName,
              inviterRole: inviterMembership?.role ?? 'ADMIN',
              recipientEmail: account.email,
              recipientIsExistingUser: true,
              temporaryName: invitation?.temporaryName,
            })
          : null
      const subject =
        renderedInvitation?.subject ??
        (isFriendAdded
          ? `[Spliit Cloud] ${label}`
          : `[Spliit Cloud] ${label} in ${group.name}`)
      const rendered = renderedInvitation
        ? renderedInvitation
        : isFriendAdded
          ? await renderFriendLedgerEmail({
              inviterName: actorName,
              isNewUser: false,
            })
          : await renderGroupActivityEmail({
              subject,
              text,
              brandBaseUrl: getWebBaseUrl(),
              groupDisplayName: group.name,
              actorName,
              activityLabel: label,
              summary,
              groupUrl: `${getWebBaseUrl()}/groups/${intent.activity.groupId}`,
            })
      await sendEmail({
        to: account.email,
        subject: rendered.subject,
        text: `${rendered.text}${unsubscribe?.textFooter ?? ''}`,
        html: appendHtmlFooter(rendered.html, unsubscribe?.htmlFooter ?? ''),
        headers: unsubscribe?.headers,
      })
    } catch (error) {
      console.warn(
        `[notifications] failed to send group email for activity ${intent.activity.activityId}:`,
        error,
      )
    }
  }
}
