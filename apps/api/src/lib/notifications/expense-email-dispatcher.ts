import { prisma } from '@spliit/db'
import type { Expense } from '@spliit/domain'
import { getCurrency } from '@spliit/domain'
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
const IMPORT_EVENT_TYPES = new Set(['EXPENSES_IMPORTED'])

function formatAmount(cents: number, currencyCode?: string | null): string {
  const currency = currencyCode ? getCurrency(currencyCode) : undefined
  const digits = currency?.decimal_digits ?? 2
  const formatted = (cents / 100).toFixed(digits)
  return currencyCode ? `${currencyCode} ${formatted}` : formatted
}

function formatDualAmount(
  amount: number,
  currencyCode: string | null | undefined,
  originalAmount: number | undefined,
  ledgerCurrencyCode: string | null | undefined,
): string {
  if (
    originalAmount != null &&
    currencyCode &&
    ledgerCurrencyCode &&
    ledgerCurrencyCode !== currencyCode
  ) {
    const original = formatAmount(originalAmount, currencyCode)
    const converted = formatAmount(amount, ledgerCurrencyCode)
    return `${original} (${converted})`
  }
  // When currencyCode is absent (same-currency expense where
  // originalCurrency is null), fall back to ledgerCurrencyCode so the
  // email shows "EUR 102.22" instead of bare "10222.00".
  return formatAmount(amount, currencyCode ?? ledgerCurrencyCode)
}

function resolveGroupDisplayName(
  groupType: string,
  groupName: string,
  members: Array<{ account: { id: string; name: string } | null }>,
  recipientAccountId: string | undefined,
  pendingTemporaryName: string | undefined,
): string {
  if (groupType !== 'FRIEND') return groupName
  if (recipientAccountId) {
    const peer = members.find(
      (m) => m.account && m.account.id !== recipientAccountId,
    )
    if (peer?.account?.name)
      return `your friend ledger with ${peer.account.name}`
  }
  if (pendingTemporaryName)
    return `your friend ledger with ${pendingTemporaryName}`
  return 'your friend ledger'
}

const GROUP_SELECT = {
  name: true,
  groupType: true,
  members: {
    where: { status: 'ACTIVE' },
    select: { account: { select: { id: true, name: true } } },
    take: 2,
  },
  invitations: {
    where: { status: 'PENDING' },
    select: { temporaryName: true },
    take: 1,
    orderBy: { createdAt: 'desc' as const },
  },
} as const

export class ExpenseEmailActivityNotificationDispatcher implements ActivityNotificationDispatcher {
  async dispatch(event: ActivityNotificationEvent): Promise<void> {
    if (IMPORT_EVENT_TYPES.has(event.type)) {
      await this.dispatchImportSummary(event)
      return
    }
    if (!EXPENSE_EVENT_TYPES.has(event.type)) return

    const parsed = parseActivityData(event.data)
    if (!parsed || parsed.kind !== 'expense') return

    const {
      title,
      amount,
      currencyCode,
      date,
      affectedParticipants,
      changedFields,
      originalAmount,
      ledgerCurrencyCode,
    } = parsed
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
      participantIds = [
        ...getAffectedParticipantIds({ newExpense: expenseForDiff }),
      ]
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
        select: GROUP_SELECT,
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

    const expenseUrl =
      event.type !== 'EXPENSE_DELETED' && event.subject?.id
        ? `${getWebBaseUrl()}/groups/${event.groupId}/expenses/${event.subject.id}`
        : `${getWebBaseUrl()}/groups/${event.groupId}`

    const amountStr =
      amount != null
        ? formatDualAmount(
            amount,
            currencyCode,
            originalAmount,
            ledgerCurrencyCode,
          )
        : null

    const preambles: Record<string, string> = {
      EXPENSE_CREATED: `Expense "${title}"${amountStr ? ` (${amountStr})` : ''} was added by ${actorName} to`,
      EXPENSE_UPDATED: `Expense "${title}" was updated by ${actorName} in`,
      EXPENSE_DELETED: `Expense "${title}"${amountStr ? ` (${amountStr})` : ''} was removed by ${actorName} from`,
    }
    const preamble = preambles[event.type]

    const subjectForType: Record<string, (dn: string) => string> = {
      EXPENSE_CREATED: (dn) =>
        `[Spliit Cloud] Expense "${title}" was added by ${actorName} to ${dn}`,
      EXPENSE_UPDATED: (dn) =>
        `[Spliit Cloud] Expense "${title}" was updated by ${actorName} in ${dn}`,
      EXPENSE_DELETED: (dn) =>
        `[Spliit Cloud] Expense "${title}" was removed by ${actorName} from ${dn}`,
    }
    const buildSubject = subjectForType[event.type]

    await this.sendToActiveMembers({
      participants,
      actor: event.actor,
      activityId: event.activityId,
      group,
      buildSubject,
      buildText: (displayName: string) => {
        const lines: string[] = []
        if (event.type === 'EXPENSE_UPDATED') {
          lines.push(`${preamble} ${displayName}.`)
          if (amountStr) lines.push(`Amount: ${amountStr}`)
          if (date) lines.push(`Date: ${date}`)
          if (changedFields?.length) {
            lines.push(`Changed: ${changedFields.join(', ')}`)
          }
        } else {
          lines.push(`${preamble} ${displayName}${date ? ` on ${date}` : ''}.`)
        }
        lines.push('')
        lines.push('View it here:')
        lines.push(expenseUrl)
        return lines.join('\n')
      },
    })
  }

  /**
   * Dispatch a single summary email for a bulk import. Instead of N
   * per-expense emails, send one email to every active group member
   * affected by any of the imported expenses.
   */
  private async dispatchImportSummary(
    event: ActivityNotificationEvent,
  ): Promise<void> {
    const parsed = parseActivityData(event.data)
    if (!parsed || parsed.kind !== 'import_summary') return

    const { count, totalAmount, currencyCode, sourceProvider } = parsed
    const participantIds = parsed.affectedParticipants ?? []
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
        select: GROUP_SELECT,
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
    const totalStr =
      totalAmount != null ? formatAmount(totalAmount, currencyCode) : null

    const groupUrl = `${getWebBaseUrl()}/groups/${event.groupId}`

    await this.sendToActiveMembers({
      participants,
      actor: event.actor,
      activityId: event.activityId,
      group,
      buildSubject: (displayName: string) =>
        `[Spliit Cloud] ${count} ${
          count === 1 ? 'expense' : 'expenses'
        } imported in ${displayName}`,
      buildText: (displayName: string) => {
        const lines: string[] = []
        lines.push(
          `${actorName} imported ${count} ${
            count === 1 ? 'expense' : 'expenses'
          }${sourceProvider ? ` from ${sourceProvider}` : ''} in ${displayName}${
            totalStr ? ` (total ${totalStr})` : ''
          }.`,
        )
        lines.push('')
        lines.push('View the group here:')
        lines.push(groupUrl)
        return lines.join('\n')
      },
    })
  }

  private async sendToActiveMembers(args: {
    participants: Array<{
      groupMember: {
        status: string
        account: { id: string; email: string } | null
      } | null
    }>
    actor: ActivityNotificationEvent['actor']
    activityId: string
    group: {
      groupType: string
      name: string
      members: Array<{ account: { id: string; name: string } | null }>
      invitations: Array<{ temporaryName: string | null }>
    }
    buildSubject: (displayName: string) => string
    buildText: (displayName: string) => string
  }): Promise<void> {
    for (const participant of args.participants) {
      const groupMember = participant.groupMember
      if (!groupMember) continue
      if (groupMember.status !== 'ACTIVE') continue
      const account = groupMember.account
      if (!account?.email) continue
      if (isPlaceholderEmail(account.email)) continue
      if (args.actor?.id === account.id && args.actor?.type === 'ACCOUNT')
        continue

      const displayName = resolveGroupDisplayName(
        args.group.groupType,
        args.group.name,
        args.group.members ?? [],
        account.id,
        args.group.invitations?.[0]?.temporaryName ?? undefined,
      )

      const subject = args.buildSubject(displayName)
      const text = args.buildText(displayName)

      try {
        await sendEmail({
          to: account.email,
          subject,
          text,
        })
      } catch (err) {
        console.warn(
          `[notifications] failed to send expense email for activity ${args.activityId}:`,
          err,
        )
      }
    }
  }
}
