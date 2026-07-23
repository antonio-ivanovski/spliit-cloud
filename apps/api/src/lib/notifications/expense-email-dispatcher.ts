import { prisma } from '@spliit/db'
import { parseActivityData } from '@spliit/domain/activities'
import {
  getNotificationCategoryForActivity,
  NotificationCategory,
  notificationCategoryFamily,
  NotificationCategoryFamily,
} from '@spliit/domain/notifications'
import { getWebBaseUrl } from '../auth/urls'
import { isPlaceholderEmail } from '../invitations/display'
import { sendEmail } from '../mail/send'
import {
  renderExpenseActivityEmail,
  type ExpenseActivityInputAny,
} from '../mail/templates/expense-activity'
import {
  buildRecurringSummaryContent,
  formatRecurrenceRule,
  type SummaryOperation,
} from './expense-notification-content'
import {
  ensureAccountIncludedAsParticipant,
  formatExpenseAmount,
  formatExpenseDualAmount,
  loadActivityChannelContext,
  loadActivityGroupAndActor,
  loadActivityRecipientMember,
  resolveCreatedExpenseRecipientIds,
  resolveGroupDisplayName,
  type ExpenseNotificationGroup,
  type ExpenseNotificationParticipant,
} from './expense-notification-shared'
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
  'RECURRING_EXPENSE_STOPPED',
])
const IMPORT_EVENT_TYPES = new Set(['EXPENSES_IMPORTED'])
const CATEGORY_BULK_EVENT_TYPES = new Set(['EXPENSE_CATEGORIES_BULK_UPDATED'])

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
    if (parsed?.kind === 'recurring_expense_summary') {
      await this.dispatchRecurringSummary(event, recipientAccountId, parsed)
      return
    }
    // Standalone recurrence stop — send a deletion-style notification
    // scoped to the template participants, excluding the actor.
    if (
      event.type === 'RECURRING_EXPENSE_STOPPED' &&
      parsed?.kind === 'recurring_expense_stopped'
    ) {
      await this.dispatchRecurrenceStopped(event, recipientAccountId, parsed)
      return
    }
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
    const participantIds =
      event.type === 'EXPENSE_CREATED' ||
      event.type === 'RECURRING_EXPENSE_CREATED'
        ? event.subject?.id
          ? await resolveCreatedExpenseRecipientIds(event.subject.id)
          : []
        : (affectedParticipants ?? [])

    if (participantIds.length === 0 && !event.includeActorAsRecipient) return

    const {
      participants: initialParticipants,
      group,
      actorName: fetchedActorName,
    } = await loadActivityChannelContext({
      groupId: event.groupId,
      participantIds,
      actor: event.actor,
    })

    if (!group) return

    // A recurring series creator may not be one of the expense's affected
    // participants. The handler still emits a targeted intent for that
    // active member, so include them in the channel's account-backed list.
    const creatorAccountId =
      event.includeActorAsRecipient && event.actor?.type === 'ACCOUNT'
        ? event.actor.id
        : undefined
    const targetedAccountId = recipientAccountId ?? creatorAccountId
    const participants = targetedAccountId
      ? await ensureAccountIncludedAsParticipant({
          groupId: event.groupId,
          participants: initialParticipants,
          accountId: targetedAccountId,
        })
      : initialParticipants

    const actorName = fetchedActorName

    const expenseUrl =
      event.type !== 'EXPENSE_DELETED' && event.subject?.id
        ? `${getWebBaseUrl()}/groups/${event.groupId}/expenses/${event.subject.id}`
        : `${getWebBaseUrl()}/groups/${event.groupId}`

    const amountStr =
      amount != null
        ? formatExpenseDualAmount(
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
      EXPENSE_DELETED: `Expense "${title}"${amountStr ? ` (${amountStr})` : ''} was removed by ${actorName}${parsed.stopped ? ' and the recurrence was stopped' : ''} from`,
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
        `[Spliit Cloud] Expense "${title}" was removed${parsed.stopped ? ' and the recurrence was stopped' : ''} by ${actorName} from ${dn}`,
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
        recurrence:
          parsed?.kind === 'expense' && parsed.recurrence
            ? formatRecurrenceRule(parsed.recurrence)
            : undefined,
        stopped: parsed?.kind === 'expense' ? parsed.stopped : undefined,
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

    const { participants, group, actorName } = await loadActivityChannelContext(
      {
        groupId: event.groupId,
        participantIds,
        actor: event.actor,
      },
    )

    if (!group) return

    const totalStr =
      totalAmount != null
        ? formatExpenseAmount(totalAmount, currencyCode)
        : null

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

    const { group, actorName } = await loadActivityGroupAndActor({
      groupId: event.groupId,
      actor: event.actor,
    })
    if (!group) return

    const groupUrl = `${getWebBaseUrl()}/groups/${event.groupId}`
    const members = await prisma.groupMember.findMany({
      where: {
        groupId: event.groupId,
        status: 'ACTIVE',
        ...(recipientAccountId ? { accountId: recipientAccountId } : {}),
      },
      select: { account: { select: { id: true, email: true } } },
    })
    const participants: ExpenseNotificationParticipant[] = members.map(
      (member) => ({
        groupMember: { status: 'ACTIVE', account: member.account },
      }),
    )

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

  private async dispatchRecurringSummary(
    event: ActivityNotificationEvent,
    recipientAccountId: string | undefined,
    parsed: Extract<
      NonNullable<ReturnType<typeof parseActivityData>>,
      { kind: 'recurring_expense_summary' }
    >,
  ): Promise<void> {
    if (!recipientAccountId) return
    const operation: SummaryOperation = parsed.operation
    const [groupAndActor, member] = await Promise.all([
      loadActivityGroupAndActor({
        groupId: event.groupId,
        actor: event.actor,
      }),
      loadActivityRecipientMember({
        groupId: event.groupId,
        recipientAccountId,
      }),
    ])
    const { group, actorName } = groupAndActor
    if (!group || !member) return
    const displayName = resolveGroupDisplayName(
      group.groupType,
      group.name,
      group.members,
      recipientAccountId,
      group.invitations[0]?.temporaryName ?? undefined,
    )
    const recurrenceMeta =
      parsed.frequency && parsed.interval
        ? {
            seriesId: parsed.seriesId ?? '',
            frequency: parsed.frequency,
            interval: parsed.interval,
            endType: parsed.endType ?? 'NEVER',
            occurrenceLimit: parsed.occurrenceLimit ?? null,
            endDate: parsed.seriesEndDate ?? null,
          }
        : null
    const content = buildRecurringSummaryContent({
      operation,
      actorName,
      displayName,
      count: parsed.count,
      title: ('title' in parsed ? parsed.title : null) as string | null,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      stopped: parsed.stopped,
      recurrenceMeta,
    })
    const groupUrl = `${getWebBaseUrl()}/groups/${event.groupId}`
    await this.sendToActiveMembers({
      participants: [{ groupMember: member }],
      actor: event.actor,
      includeActorAsRecipient: true,
      activityId: event.activityId,
      group,
      buildSubject: () => content.subject,
      buildText: () => `${content.body}\n\nView the group here:\n${groupUrl}`,
      templateFor: (): ExpenseActivityInputAny => ({
        kind: 'recurring_expense_summary',
        subject: '',
        text: '',
        brandBaseUrl: getWebBaseUrl(),
        groupDisplayName: displayName,
        actorName,
        title: ('title' in parsed ? parsed.title : null) as string | null,
        count: parsed.count,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        groupUrl,
        operation,
        stopped: parsed.stopped,
        recurrence: recurrenceMeta
          ? formatRecurrenceRule(recurrenceMeta)
          : undefined,
      }),
      recipientAccountId,
      category:
        operation === 'create'
          ? NotificationCategory.RECURRING_EXPENSE_CREATED
          : NotificationCategory.EXPENSE_CHANGED,
    })
  }

  private async dispatchRecurrenceStopped(
    event: ActivityNotificationEvent,
    recipientAccountId: string | undefined,
    parsed: Extract<
      NonNullable<ReturnType<typeof parseActivityData>>,
      { kind: 'recurring_expense_stopped' }
    >,
  ): Promise<void> {
    if (!recipientAccountId) return
    const [groupAndActor, member] = await Promise.all([
      loadActivityGroupAndActor({
        groupId: event.groupId,
        actor: event.actor,
      }),
      loadActivityRecipientMember({
        groupId: event.groupId,
        recipientAccountId,
      }),
    ])
    const { group, actorName } = groupAndActor
    if (!group || !member) return
    const displayName = resolveGroupDisplayName(
      group.groupType,
      group.name,
      group.members,
      recipientAccountId,
      group.invitations[0]?.temporaryName ?? undefined,
    )
    const title = parsed.title ? ` "${parsed.title}"` : ''
    const recurrenceText =
      parsed.frequency && parsed.interval
        ? formatRecurrenceRule({
            seriesId: parsed.seriesId,
            frequency: parsed.frequency,
            interval: parsed.interval,
            endType: parsed.endType,
            occurrenceLimit: parsed.occurrenceLimit ?? null,
            endDate: parsed.endDate ?? null,
          })
        : undefined
    const recurrenceDesc = recurrenceText ? ` (${recurrenceText})` : ''
    const groupUrl = `${getWebBaseUrl()}/groups/${event.groupId}`
    await this.sendToActiveMembers({
      participants: [{ groupMember: member }],
      actor: event.actor,
      includeActorAsRecipient: false,
      activityId: event.activityId,
      group,
      buildSubject: () =>
        `[Spliit Cloud] Recurring expense stopped in ${displayName}`,
      buildText: () =>
        `${actorName} stopped the recurring expense${title}${recurrenceDesc} in ${displayName}.`,
      templateFor: (): ExpenseActivityInputAny => ({
        kind: 'expense',
        subject: '',
        text: '',
        eventType: 'RECURRING_EXPENSE_STOPPED' as const,
        brandBaseUrl: getWebBaseUrl(),
        groupDisplayName: displayName,
        actorName,
        title: parsed.title ?? 'Recurring expense',
        amountStr: null,
        date: null,
        expenseUrl: groupUrl,
        recurrence: recurrenceText,
      }),
      recipientAccountId,
      category: NotificationCategory.EXPENSE_CHANGED,
    })
  }

  private async sendToActiveMembers(args: {
    participants: Array<ExpenseNotificationParticipant>
    actor: ActivityNotificationEvent['actor']
    includeActorAsRecipient?: boolean
    activityId: string
    group: ExpenseNotificationGroup
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
