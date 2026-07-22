import { prisma } from '@spliit/db'
import type { Expense } from '@spliit/domain'
import { getCurrency } from '@spliit/domain'
import { parseActivityData } from '@spliit/domain/activities'
import {
  getNotificationCategoryForActivity,
  NotificationCategory,
  notificationCategoryFamily,
  NotificationCategoryFamily,
} from '@spliit/domain/notifications'
import { getAffectedParticipantIds } from '../api/expense-activity-diff'
import { getWebBaseUrl } from '../auth/urls'
import { isPlaceholderEmail } from '../invitations/display'
import { sendEmail } from '../mail/send'
import {
  renderExpenseActivityEmail,
  type ExpenseActivityInputAny,
} from '../mail/templates/expense-activity'
import type {
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
  ActivityNotificationIntent,
} from './types'
import { buildEmailUnsubscribeMetadata } from './unsubscribe'

const EXPENSE_EVENT_TYPES = new Set([
  'EXPENSE_CREATED',
  'RECURRING_EXPENSE_CREATED',
  'EXPENSE_UPDATED',
  'EXPENSE_DELETED',
])
const IMPORT_EVENT_TYPES = new Set(['EXPENSES_IMPORTED'])
const CATEGORY_BULK_EVENT_TYPES = new Set(['EXPENSE_CATEGORIES_BULK_UPDATED'])

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

type Participant = {
  groupMember: {
    status: string
    account: { id: string; email: string } | null
  } | null
}
type Group = {
  groupType: string
  name: string
  members: Array<{ account: { id: string; name: string } | null }>
  invitations: Array<{ temporaryName: string | null }>
}

export class ExpenseEmailActivityNotificationDispatcher implements ActivityNotificationDispatcher {
  async dispatch(
    input: ActivityNotificationEvent | ActivityNotificationIntent,
  ): Promise<void> {
    const event = 'activity' in input ? input.activity : input
    const recipientAccountId =
      'activity' in input ? input.recipientAccountId : undefined
    const eventCategory =
      event.notificationCategory ??
      getNotificationCategoryForActivity(event.type)
    if (!eventCategory) return
    const category = 'activity' in input ? input.category : eventCategory
    if (category !== eventCategory) return
    if (
      notificationCategoryFamily[category] !==
      NotificationCategoryFamily.EXPENSE
    )
      return
    if (IMPORT_EVENT_TYPES.has(event.type)) {
      await this.dispatchImportSummary(event, recipientAccountId)
      return
    }
    if (CATEGORY_BULK_EVENT_TYPES.has(event.type)) {
      await this.dispatchCategoryBulkSummary(event, recipientAccountId)
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
    if (
      event.type === 'EXPENSE_CREATED' ||
      event.type === 'RECURRING_EXPENSE_CREATED'
    ) {
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

    if (participantIds.length === 0 && !event.includeActorAsRecipient) return

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

    // A recurring series creator may not be one of the expense's affected
    // participants. The handler still emits a targeted intent for that
    // active member, so include them in the channel's account-backed list.
    const creatorAccountId =
      event.includeActorAsRecipient && event.actor?.type === 'ACCOUNT'
        ? event.actor.id
        : undefined
    const targetedAccountId = recipientAccountId ?? creatorAccountId
    if (targetedAccountId && event.includeActorAsRecipient) {
      const hasRecipient = participants.some(
        (participant) =>
          participant.groupMember?.account?.id === targetedAccountId,
      )
      if (!hasRecipient) {
        const member = await prisma.groupMember.findFirst({
          where: {
            groupId: event.groupId,
            accountId: targetedAccountId,
            status: 'ACTIVE',
          },
          select: {
            status: true,
            account: { select: { id: true, email: true, name: true } },
          },
        })
        if (member?.account) {
          participants.push({
            groupMember: { status: member.status, account: member.account },
          } as (typeof participants)[number])
        }
      }
    }

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
      RECURRING_EXPENSE_CREATED: `Recurring expense "${title}"${amountStr ? ` (${amountStr})` : ''} was created by ${actorName} in`,
      EXPENSE_UPDATED: `Expense "${title}" was updated by ${actorName} in`,
      EXPENSE_DELETED: `Expense "${title}"${amountStr ? ` (${amountStr})` : ''} was removed by ${actorName} from`,
    }
    const preamble = preambles[event.type]

    const subjectForType: Record<string, (dn: string) => string> = {
      EXPENSE_CREATED: (dn) =>
        `[Spliit Cloud] Expense "${title}" was added by ${actorName} to ${dn}`,
      RECURRING_EXPENSE_CREATED: (dn) =>
        `[Spliit Cloud] Recurring expense "${title}" was created by ${actorName} in ${dn}`,
      EXPENSE_UPDATED: (dn) =>
        `[Spliit Cloud] Expense "${title}" was updated by ${actorName} in ${dn}`,
      EXPENSE_DELETED: (dn) =>
        `[Spliit Cloud] Expense "${title}" was removed by ${actorName} from ${dn}`,
    }
    const buildSubject = subjectForType[event.type]
    const buildText = (displayName: string) => {
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
    }

    // Event type narrowing for the React Email template input.
    const eventType:
      | 'EXPENSE_CREATED'
      | 'RECURRING_EXPENSE_CREATED'
      | 'EXPENSE_UPDATED'
      | 'EXPENSE_DELETED' =
      event.type === 'RECURRING_EXPENSE_CREATED'
        ? 'RECURRING_EXPENSE_CREATED'
        : event.type === 'EXPENSE_UPDATED'
          ? 'EXPENSE_UPDATED'
          : event.type === 'EXPENSE_DELETED'
            ? 'EXPENSE_DELETED'
            : 'EXPENSE_CREATED'

    const baseTemplate = {
      eventType,
      brandBaseUrl: getWebBaseUrl(),
      actorName,
      title,
      amountStr,
      date: date ?? null,
      expenseUrl,
    } as const
    const changedFieldsForTemplate =
      event.type === 'EXPENSE_UPDATED' ? changedFields : undefined

    await this.sendToActiveMembers({
      participants,
      actor: event.actor,
      includeActorAsRecipient: event.includeActorAsRecipient,
      activityId: event.activityId,
      group,
      buildSubject,
      buildText,
      templateFor: (displayName: string): ExpenseActivityInputAny => ({
        kind: 'expense',
        subject: buildSubject(displayName),
        text: buildText(displayName),
        brandBaseUrl: baseTemplate.brandBaseUrl,
        groupDisplayName: displayName,
        eventType: baseTemplate.eventType,
        actorName: baseTemplate.actorName,
        title: baseTemplate.title,
        amountStr: baseTemplate.amountStr,
        date: baseTemplate.date,
        changedFields: changedFieldsForTemplate,
        expenseUrl: baseTemplate.expenseUrl,
      }),
      recipientAccountId,
      category,
    })
  }

  /**
   * Dispatch a single summary email for a bulk import. Instead of N
   * per-expense emails, send one email to every active group member
   * affected by any of the imported expenses.
   */
  private async dispatchImportSummary(
    event: ActivityNotificationEvent,
    recipientAccountId?: string,
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
    const brandBaseUrl = getWebBaseUrl()

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
      templateFor: (displayName: string): ExpenseActivityInputAny => ({
        kind: 'import_summary',
        subject: `[Spliit Cloud] ${count} ${
          count === 1 ? 'expense' : 'expenses'
        } imported in ${displayName}`,
        text: '',
        brandBaseUrl,
        groupDisplayName: displayName,
        actorName,
        count,
        sourceProvider: sourceProvider ?? null,
        totalStr,
        groupUrl,
      }),
      recipientAccountId,
      category: NotificationCategory.EXPENSE_CHANGED,
    })
  }

  private async dispatchCategoryBulkSummary(
    event: ActivityNotificationEvent,
    recipientAccountId?: string,
  ): Promise<void> {
    const parsed = parseActivityData(event.data)
    if (!parsed || parsed.kind !== 'expense_categories_bulk_updated') return

    const [group, actorAccount, members] = await Promise.all([
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
      prisma.groupMember.findMany({
        where: {
          groupId: event.groupId,
          status: 'ACTIVE',
          ...(recipientAccountId ? { accountId: recipientAccountId } : {}),
        },
        select: { account: { select: { id: true, email: true } } },
      }),
    ])
    if (!group) return

    const actorName = actorAccount?.name ?? 'Someone'
    const groupUrl = `${getWebBaseUrl()}/groups/${event.groupId}`
    const participants: Participant[] = members.map((member) => ({
      groupMember: { status: 'ACTIVE', account: member.account },
    }))

    await this.sendToActiveMembers({
      participants,
      actor: event.actor,
      activityId: event.activityId,
      group,
      buildSubject: (displayName) =>
        `[Spliit Cloud] Expense categories updated in ${displayName}`,
      buildText: (displayName) =>
        `${actorName} updated categories for ${parsed.count} ${
          parsed.count === 1 ? 'expense' : 'expenses'
        } in ${displayName}.\n\nView the group here:\n${groupUrl}`,
      templateFor: (displayName) => ({
        kind: 'expense_categories_bulk_updated',
        subject: '',
        text: '',
        brandBaseUrl: getWebBaseUrl(),
        groupDisplayName: displayName,
        actorName,
        count: parsed.count,
        distinctCategories: parsed.distinctCategories ?? null,
        groupUrl,
      }),
      recipientAccountId,
      category: NotificationCategory.EXPENSE_CHANGED,
    })
  }

  private async sendToActiveMembers(args: {
    participants: Array<Participant>
    actor: ActivityNotificationEvent['actor']
    includeActorAsRecipient?: boolean
    activityId: string
    group: Group
    buildSubject: (displayName: string) => string
    buildText: (displayName: string) => string
    templateFor: (displayName: string) => ExpenseActivityInputAny
    recipientAccountId?: string
    category: NotificationCategory
  }): Promise<void> {
    for (const participant of args.participants) {
      const groupMember = participant.groupMember
      if (!groupMember) continue
      if (groupMember.status !== 'ACTIVE') continue
      const account = groupMember.account
      if (!account?.email) continue
      if (args.recipientAccountId && account.id !== args.recipientAccountId)
        continue
      if (isPlaceholderEmail(account.email)) continue
      if (
        args.actor?.id === account.id &&
        args.actor?.type === 'ACCOUNT' &&
        !args.includeActorAsRecipient
      )
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
      const templateInput = args.templateFor(displayName)
      // Pass the canonical subject/text computed by the dispatcher so
      // the rendered email matches the test contract.
      const finalInput = { ...templateInput, subject, text }
      const unsubscribe = await buildEmailUnsubscribeMetadata({
        accountId: account.id,
        category: args.category,
      })
      const rendered = await renderExpenseActivityEmail({
        ...finalInput,
        unsubscribeUrl: unsubscribe?.url,
      })

      try {
        await sendEmail({
          to: account.email,
          ...rendered,
          text: `${rendered.text}${unsubscribe?.textFooter ?? ''}`,
          headers: unsubscribe?.headers,
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
