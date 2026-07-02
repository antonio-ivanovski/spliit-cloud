import { prisma } from '@spliit/db'
import type { Expense } from '@spliit/domain'
import { parseActivityData } from '@spliit/domain/activities'
import { getAffectedParticipantIds } from '../api/expense-activity-diff'
import { getWebBaseUrl } from '../auth/urls'
import { isPlaceholderEmail } from '../invitations/display'
import { sendEmail } from '../mail/send'
import type {
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
} from './types'

const EXPENSE_EVENT_TYPES = new Set([
  'EXPENSE_CREATED',
  'EXPENSE_UPDATED',
  'EXPENSE_DELETED',
])

function formatAmount(cents: number, currencyCode?: string | null): string {
  const formatted = (cents / 100).toFixed(2)
  return currencyCode ? `${currencyCode} ${formatted}` : formatted
}

export class ExpenseEmailActivityNotificationDispatcher
  implements ActivityNotificationDispatcher
{
  async dispatch(event: ActivityNotificationEvent): Promise<void> {
    if (!EXPENSE_EVENT_TYPES.has(event.type)) return

    const parsed = parseActivityData(event.data)
    if (!parsed || parsed.kind !== 'expense') return

    const { title, amount, currencyCode, date, affectedParticipants, changedFields } = parsed
    if (!title) return

    // Resolve affected participant IDs.
    // For CREATED we reload the expense (participants are all on the
    // expense). For UPDATED and DELETED we use the pre-computed union
    // (old + new) from the activity payload so removed participants
    // who are still active members still get notified.
    let participantIds: string[]
    if (event.type === 'EXPENSE_CREATED') {
      if (!event.subject?.id) return
      const raw = await prisma.expense.findUnique({
        where: { id: event.subject.id },
        select: {
          paidByList: { select: { ledgerParticipantId: true, shares: true } },
          paidFor: { select: { ledgerParticipantId: true, shares: true } },
          items: {
            select: {
              id: true,
              paidFor: { select: { ledgerParticipantId: true, shares: true } },
            },
          },
          itemizedRemainder: {
            select: {
              splitMode: true,
              paidFor: { select: { ledgerParticipantId: true, shares: true } },
            },
          },
        },
      })
      if (!raw) return
      const expenseForDiff = {
        paidByList: raw.paidByList.map((pb) => ({
          participant: pb.ledgerParticipantId,
          shares: pb.shares,
        })),
        paidFor: raw.paidFor.map((pf) => ({
          participant: pf.ledgerParticipantId,
          shares: pf.shares,
        })),
        items: (raw.items ?? []).map((item) => ({
          id: item.id,
          paidFor: item.paidFor.map((pf) => ({
            participant: pf.ledgerParticipantId,
            shares: pf.shares,
          })),
        })),
        itemizedRemainder: raw.itemizedRemainder
          ? {
              splitMode: raw.itemizedRemainder.splitMode,
              paidFor: raw.itemizedRemainder.paidFor.map((pf) => ({
                participant: pf.ledgerParticipantId,
                shares: pf.shares,
              })),
            }
          : undefined,
      } as unknown as Expense
      participantIds = [...getAffectedParticipantIds({ newExpense: expenseForDiff })]
    } else {
      participantIds = affectedParticipants ?? []
    }

    if (participantIds.length === 0) return

    const [participants, group, actorAccount] = await Promise.all([
      prisma.ledgerParticipant.findMany({
        where: { id: { in: participantIds } },
        include: {
          groupMember: { include: { account: true } },
        },
      }),
      prisma.group.findUnique({
        where: { id: event.groupId },
        select: { name: true },
      }),
      event.actor?.type === 'ACCOUNT'
        ? prisma.account.findUnique({
            where: { id: event.actor.id },
            select: { name: true },
          })
        : Promise.resolve(null),
    ])

    if (!group) return

    const actorName = actorAccount?.name ?? 'Someone'

    const verb =
      event.type === 'EXPENSE_CREATED'
        ? 'added'
        : event.type === 'EXPENSE_UPDATED'
          ? 'updated'
          : 'removed'

    const subject = `[Spliit Cloud] ${title} was ${verb} in ${group.name}`

    const expenseUrl =
      event.type !== 'EXPENSE_DELETED' && event.subject?.id
        ? `${getWebBaseUrl()}/groups/${event.groupId}/expenses/${event.subject.id}`
        : `${getWebBaseUrl()}/groups/${event.groupId}`

    const amountStr = amount != null ? formatAmount(amount, currencyCode) : null

    const bodyLines: string[] = []
    if (event.type === 'EXPENSE_CREATED') {
      bodyLines.push(
        `${actorName} added "${title}"${amountStr ? ` (${amountStr})` : ''} in ${group.name}${date ? ` on ${date}` : ''}.`,
      )
    } else if (event.type === 'EXPENSE_UPDATED') {
      bodyLines.push(`${actorName} updated "${title}" in ${group.name}.`)
      if (amountStr) bodyLines.push(`Amount: ${amountStr}`)
      if (date) bodyLines.push(`Date: ${date}`)
      if (changedFields?.length) {
        bodyLines.push(`Changed: ${changedFields.join(', ')}`)
      }
    } else {
      bodyLines.push(
        `${actorName} removed "${title}"${amountStr ? ` (${amountStr})` : ''} from ${group.name}${date ? ` on ${date}` : ''}.`,
      )
    }
    bodyLines.push('')
    bodyLines.push(`View it here:`)
    bodyLines.push(expenseUrl)

    const text = bodyLines.join('\n')

    for (const participant of participants) {
      if (!participant.groupMember) continue
      if (participant.groupMember.status !== 'ACTIVE') continue
      const account = participant.groupMember.account
      if (!account?.email) continue
      if (isPlaceholderEmail(account.email)) continue
      if (event.actor?.id === account.id && event.actor?.type === 'ACCOUNT') continue

      try {
        await sendEmail({ to: account.email, subject, text })
      } catch (err) {
        console.warn(
          `[notifications] failed to send expense email for activity ${event.activityId}:`,
          err,
        )
      }
    }
  }
}
