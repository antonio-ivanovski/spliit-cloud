import { prisma } from '@spliit/db'
import { formatBudgetPeriodRange } from '@spliit/domain'

import { getWebBaseUrl } from '../auth/urls'
import { isPlaceholderEmail } from '../invitations/display'
import { sendEmail } from '../mail/send'
import { renderBudgetAlertEmail } from '../mail/templates/budget-alert'
import { renderExpenseActivityEmail } from '../mail/templates/expense-activity'
import { renderFriendLedgerEmail } from '../mail/templates/friend-ledger'
import { renderGroupActivityEmail } from '../mail/templates/group-activity'
import {
  PermanentDeliveryError,
  TransientDeliveryError,
  type EmailDeliverySender,
} from './delivery-senders'
import type { DeliverySnapshotV1 } from './delivery-snapshot'
import {
  formatNotificationAmount,
  formatNotificationDate,
  formatNotificationNumber,
  formatNotificationPercent,
} from './format'
import { buildEmailUnsubscribeMetadata } from './unsubscribe'

const MESSAGE_ID_DOMAIN = 'spliit.app'

function deliveryMessageId(deliveryId: string): string {
  return `<${deliveryId}@${MESSAGE_ID_DOMAIN}>`
}

function actorName(snapshot: DeliverySnapshotV1): string {
  return snapshot.actor?.name ?? 'Someone'
}

function isTransientCode(code: string | undefined): boolean {
  if (!code) return false
  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'EPIPE'
  )
}

function isPermanentCode(code: string | undefined): boolean {
  if (!code) return false
  return code === 'EENVELOPE' || code === 'EADDRINFO' || code === 'EINVAL'
}

function classifySmtpError(err: unknown): 'transient' | 'permanent' {
  if (!err || typeof err !== 'object') return 'transient'
  const record = err as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code : undefined
  const responseCode =
    typeof record.responseCode === 'number' ? record.responseCode : undefined
  if (isPermanentCode(code)) return 'permanent'
  if (isTransientCode(code)) return 'transient'
  if (typeof responseCode === 'number') {
    if (responseCode >= 500) return 'permanent'
    if (responseCode >= 400) return 'transient'
  }
  if (typeof record.command === 'string' && !responseCode) return 'permanent'
  return 'transient'
}

function describeError(err: unknown): {
  code: string
  providerStatus?: number
  message: string
} {
  if (!err || typeof err !== 'object') {
    return { code: 'UNKNOWN', message: 'Unknown SMTP error' }
  }
  const record = err as Record<string, unknown>
  const code =
    typeof record.code === 'string' || typeof record.code === 'number'
      ? String(record.code)
      : 'UNKNOWN'
  const providerStatus =
    typeof record.responseCode === 'number' ? record.responseCode : undefined
  const rawMessage =
    typeof record.message === 'string' && record.message.length > 0
      ? record.message
      : 'SMTP send failed'
  const cleaned = rawMessage.replace(/\s+/g, ' ').trim().slice(0, 200)
  return { code, providerStatus, message: cleaned }
}

function renderSnapshotEmail(args: {
  snapshot: DeliverySnapshotV1
  unsubscribeUrl?: string
  brandBaseUrl: string
}): Promise<{ subject: string; text: string; html: string }> {
  const { snapshot, unsubscribeUrl, brandBaseUrl } = args
  // Group-scoped phrasing ("in Trip") uses the real group name, never the
  // recipient's display name. The recipient display name (exosed on the
  // snapshot) is reserved for greetings addressed to the recipient.
  const groupDisplayName = snapshot.group.name
  const actor = actorName(snapshot)
  const link = snapshot.link
  const locale = snapshot.recipient.locale ?? 'en-US'

  switch (snapshot.kind) {
    case 'budget_alert': {
      const used =
        formatNotificationAmount(
          snapshot.budget.used,
          snapshot.budget.currencyCode,
          locale,
        ) ?? String(snapshot.budget.used)
      const limit =
        formatNotificationAmount(
          snapshot.budget.limit,
          snapshot.budget.currencyCode,
          locale,
        ) ?? String(snapshot.budget.limit)
      const percentage =
        snapshot.budget.limit > 0
          ? (snapshot.budget.used / snapshot.budget.limit) * 100
          : 0
      const periodStart = new Date(snapshot.budget.periodStart)
      const periodEnd = new Date(snapshot.budget.periodEnd)
      const periodRange = snapshot.budget.period
        ? formatBudgetPeriodRange(
            snapshot.budget.period,
            periodStart,
            periodEnd,
            (date) => formatNotificationDate(date, locale) ?? '',
          )
        : `${formatNotificationDate(periodStart, locale) ?? ''} – ${formatNotificationDate(periodEnd, locale) ?? ''}`
      return renderBudgetAlertEmail({
        kind: 'budget_alert',
        subject: `[Spliit Cloud] ${snapshot.budget.alertType === 'OVER' ? 'Budget exceeded' : 'Budget trending over'}: ${snapshot.budget.name}`,
        text: `${snapshot.budget.name}: ${used} of ${limit} spent in ${groupDisplayName}.\n\nView budget:\n${link}`,
        brandBaseUrl,
        budgetName: snapshot.budget.name,
        groupName: groupDisplayName,
        usedStr: used,
        limitStr: limit,
        percentage,
        percentageLabel: formatNotificationPercent(percentage, locale),
        periodRange,
        alertType: snapshot.budget.alertType,
        budgetUrl: link,
        unsubscribeUrl,
      })
    }
    case 'expense_created':
      return renderExpenseActivityEmail({
        kind: 'expense',
        subject: `[Spliit Cloud] ${actor} added "${snapshot.expense.description}" to ${groupDisplayName}`,
        text: `${actor} added "${snapshot.expense.description}" in ${groupDisplayName}.\n\nView it here:\n${link}`,
        brandBaseUrl,
        groupDisplayName: groupDisplayName,
        actorName: actor,
        title: snapshot.expense.description,
        amountStr: formatNotificationAmount(
          snapshot.expense.amount,
          snapshot.expense.currencyCode,
          locale,
        ),
        date: formatNotificationDate(snapshot.date, locale),
        expenseUrl: link,
        unsubscribeUrl,
        eventType: 'EXPENSE_CREATED',
      })
    case 'expense_updated':
      return renderExpenseActivityEmail({
        kind: 'expense',
        subject: `[Spliit Cloud] ${actor} updated "${snapshot.expense.description}" in ${groupDisplayName}`,
        text: `${actor} updated "${snapshot.expense.description}" in ${groupDisplayName}.\n\nChanged: ${snapshot.changedFields.join(', ')}\n\nView it here:\n${link}`,
        brandBaseUrl,
        groupDisplayName: groupDisplayName,
        actorName: actor,
        title: snapshot.expense.description,
        amountStr: formatNotificationAmount(
          snapshot.expense.amount,
          snapshot.expense.currencyCode,
          locale,
        ),
        date: null,
        changedFields: snapshot.changedFields,
        expenseUrl: link,
        unsubscribeUrl,
        eventType: 'EXPENSE_UPDATED',
      })
    case 'expense_deleted':
      return renderExpenseActivityEmail({
        kind: 'expense',
        subject: `[Spliit Cloud] ${actor} removed "${snapshot.expense.description}" from ${groupDisplayName}`,
        text: `${actor} removed "${snapshot.expense.description}" from ${groupDisplayName}${snapshot.stopped ? ' and the recurrence was stopped' : ''}.\n\nView it here:\n${link}`,
        brandBaseUrl,
        groupDisplayName: groupDisplayName,
        actorName: actor,
        title: snapshot.expense.description,
        amountStr: formatNotificationAmount(
          snapshot.expense.amount,
          snapshot.expense.currencyCode,
          locale,
        ),
        date: formatNotificationDate(snapshot.date, locale),
        stopped: snapshot.stopped,
        expenseUrl: link,
        unsubscribeUrl,
        eventType: snapshot.stopped
          ? 'RECURRING_EXPENSE_STOPPED'
          : 'EXPENSE_DELETED',
      })
    case 'expense_comment': {
      const excerpt = snapshot.comment.excerpt.trim()
      return renderExpenseActivityEmail({
        kind: 'expense_comment',
        subject: `[Spliit Cloud] ${actor} commented on "${snapshot.expense.description}" in ${groupDisplayName}`,
        text: `${actor} commented on "${snapshot.expense.description}" in ${groupDisplayName}.${excerpt ? `\n\n"${excerpt}"` : ''}\n\nView it here:\n${link}`,
        brandBaseUrl,
        groupDisplayName: groupDisplayName,
        actorName: actor,
        title: snapshot.expense.description,
        excerpt,
        expenseUrl: link,
        unsubscribeUrl,
      })
    }
    case 'recurring_created':
      return renderExpenseActivityEmail({
        kind: 'expense',
        subject: `[Spliit Cloud] ${actor} created recurring "${snapshot.expense.description}" in ${groupDisplayName}`,
        text: `${actor} created recurring "${snapshot.expense.description}" in ${groupDisplayName} (${snapshot.recurrence.rule}).\n\nView it here:\n${link}`,
        brandBaseUrl,
        groupDisplayName: groupDisplayName,
        actorName: actor,
        title: snapshot.expense.description,
        amountStr: formatNotificationAmount(
          snapshot.expense.amount,
          snapshot.expense.currencyCode,
          locale,
        ),
        date: formatNotificationDate(snapshot.date, locale),
        recurrence: snapshot.recurrence.rule,
        expenseUrl: link,
        unsubscribeUrl,
        eventType: 'RECURRING_EXPENSE_CREATED',
      })
    case 'recurring_occurrence':
      return renderExpenseActivityEmail({
        kind: 'expense',
        subject: `[Spliit Cloud] ${actor} added "${snapshot.expense.description}" to ${groupDisplayName}`,
        text: `${actor} added "${snapshot.expense.description}" in ${groupDisplayName} (${snapshot.recurrence.rule}).\n\nView it here:\n${link}`,
        brandBaseUrl,
        groupDisplayName: groupDisplayName,
        actorName: actor,
        title: snapshot.expense.description,
        amountStr: formatNotificationAmount(
          snapshot.expense.amount,
          snapshot.expense.currencyCode,
          locale,
        ),
        date: null,
        recurrence: snapshot.recurrence.rule,
        expenseUrl: link,
        unsubscribeUrl,
        eventType: 'EXPENSE_CREATED',
      })
    case 'recurring_summary': {
      const noun = snapshot.occurrenceCount === 1 ? 'expense' : 'expenses'
      const countLabel = formatNotificationNumber(
        snapshot.occurrenceCount,
        locale,
      )
      const startDate =
        formatNotificationDate(snapshot.dateRange.start, locale) ??
        snapshot.dateRange.start
      const endDate =
        formatNotificationDate(snapshot.dateRange.end, locale) ??
        snapshot.dateRange.end
      const verb =
        snapshot.operation === 'update'
          ? 'updated'
          : snapshot.operation === 'delete'
            ? 'removed'
            : 'added'
      const heading =
        snapshot.operation === 'update'
          ? `${countLabel} recurring ${noun} updated`
          : snapshot.operation === 'delete'
            ? `${countLabel} recurring ${noun} removed`
            : `${countLabel} recurring ${noun} caught up`
      const titleStr = snapshot.title ? ` "${snapshot.title}"` : ''
      const stoppedSuffix = snapshot.stopped
        ? ' and the recurrence was stopped'
        : ''
      return renderExpenseActivityEmail({
        kind: 'recurring_expense_summary',
        subject: `[Spliit Cloud] ${heading} in ${groupDisplayName}`,
        text: `${actor} ${verb} ${countLabel} recurring ${noun}${titleStr} (${snapshot.recurrence.rule}) in ${groupDisplayName} for ${startDate} through ${endDate}${stoppedSuffix}.\n\nView it here:\n${link}`,
        brandBaseUrl,
        groupDisplayName: groupDisplayName,
        actorName: actor,
        title: snapshot.title,
        count: snapshot.occurrenceCount,
        countLabel,
        startDate,
        endDate,
        groupUrl: link,
        unsubscribeUrl,
        operation: snapshot.operation,
        stopped: snapshot.stopped,
        recurrence: snapshot.recurrence.rule,
      })
    }
    case 'recurring_stopped': {
      const titleStr = snapshot.title ? ` "${snapshot.title}"` : ''
      return renderExpenseActivityEmail({
        kind: 'expense',
        subject: `[Spliit Cloud] ${actor} stopped recurring${titleStr} in ${groupDisplayName}`,
        text: `${actor} stopped the recurring expense${titleStr} (${snapshot.recurrence.rule}) in ${groupDisplayName}.\n\nView it here:\n${link}`,
        brandBaseUrl,
        groupDisplayName: groupDisplayName,
        actorName: actor,
        title: snapshot.title ?? 'Recurring expense',
        amountStr: null,
        date: null,
        recurrence: snapshot.recurrence.rule,
        expenseUrl: link,
        unsubscribeUrl,
        eventType: 'RECURRING_EXPENSE_STOPPED',
      })
    }
    case 'import_summary': {
      const noun = snapshot.import.count === 1 ? 'expense' : 'expenses'
      const totalStr = formatNotificationAmount(
        snapshot.totalAmount ?? null,
        snapshot.currencyCode ?? null,
        locale,
      )
      const source = snapshot.import.source
      return renderExpenseActivityEmail({
        kind: 'import_summary',
        subject: `[Spliit Cloud] ${formatNotificationNumber(snapshot.import.count, locale)} ${noun} imported in ${groupDisplayName}`,
        text: `${actor} imported ${formatNotificationNumber(snapshot.import.count, locale)} ${noun}${source ? ` from ${source}` : ''} in ${groupDisplayName}${totalStr ? ` (total ${totalStr})` : ''}.\n\nView the group here:\n${link}`,
        brandBaseUrl,
        groupDisplayName: groupDisplayName,
        actorName: actor,
        count: snapshot.import.count,
        countLabel: formatNotificationNumber(snapshot.import.count, locale),
        sourceProvider: source,
        totalStr,
        groupUrl: link,
        unsubscribeUrl,
      })
    }
    case 'category_bulk': {
      const noun = snapshot.count === 1 ? 'expense' : 'expenses'
      return renderExpenseActivityEmail({
        kind: 'expense_categories_bulk_updated',
        subject: `[Spliit Cloud] Expense categories updated in ${groupDisplayName}`,
        text: `${actor} updated categories for ${formatNotificationNumber(snapshot.count, locale)} ${noun}${snapshot.distinctCategories != null ? ` across ${formatNotificationNumber(snapshot.distinctCategories, locale)} categories` : ''} in ${groupDisplayName}.\n\nView the group here:\n${link}`,
        brandBaseUrl,
        groupDisplayName: groupDisplayName,
        actorName: actor,
        count: snapshot.count,
        countLabel: formatNotificationNumber(snapshot.count, locale),
        distinctCategories: snapshot.distinctCategories ?? null,
        distinctCategoriesLabel:
          snapshot.distinctCategories != null
            ? formatNotificationNumber(snapshot.distinctCategories, locale)
            : null,
        groupUrl: link,
        unsubscribeUrl,
      })
    }
    case 'group_activity':
      return renderGroupActivityEmail({
        subject: `[Spliit Cloud] ${snapshot.action} in ${groupDisplayName}`,
        text: `${snapshot.action} in ${groupDisplayName} by ${actor}${snapshot.summary ? `.\n\n${snapshot.summary}` : ''}.\n\nView the group here:\n${link}`,
        brandBaseUrl,
        groupDisplayName: groupDisplayName,
        actorName: actor,
        activityLabel: snapshot.action,
        summary: snapshot.summary ?? null,
        groupUrl: link,
        unsubscribeUrl,
      })
    case 'settlement':
      return renderExpenseActivityEmail({
        kind: 'expense',
        subject: `[Spliit Cloud] ${actor} settled "${snapshot.expense.description}" in ${groupDisplayName}`,
        text: `${actor} settled "${snapshot.expense.description}" in ${groupDisplayName}.\n\nView it here:\n${link}`,
        brandBaseUrl,
        groupDisplayName: groupDisplayName,
        actorName: actor,
        title: snapshot.expense.description,
        amountStr: formatNotificationAmount(
          snapshot.expense.amount,
          snapshot.expense.currencyCode,
          locale,
        ),
        date: null,
        expenseUrl: link,
        unsubscribeUrl,
        eventType: 'EXPENSE_CREATED',
      })
    case 'invitation':
      return renderGroupActivityEmail({
        subject: `[Spliit Cloud] ${snapshot.inviterName} invited you to ${snapshot.group.name}`,
        text: `${snapshot.inviterName} (${snapshot.inviterRole.toLowerCase()}) invited you to join "${snapshot.group.name}" on Spliit Cloud.\n\nOpen the invitation:\n${link}`,
        brandBaseUrl,
        groupDisplayName: snapshot.group.name,
        actorName: snapshot.inviterName,
        activityLabel: `${snapshot.inviterName} invited you to ${snapshot.group.name}`,
        summary: null,
        groupUrl: link,
        unsubscribeUrl,
      })
    case 'friend_added':
      return renderFriendLedgerEmail({
        inviterName: snapshot.friendName,
        isNewUser: false,
        unsubscribeUrl,
      })
  }
}

export class EmailDeliverySenderImpl implements EmailDeliverySender {
  async send(args: {
    deliveryId: string
    snapshot: DeliverySnapshotV1
    recipientAccountId: string
  }): Promise<void> {
    const account = await prisma.account.findUnique({
      where: { id: args.recipientAccountId },
      select: { email: true, emailVerified: true },
    })
    if (!account || !account.email) {
      throw new PermanentDeliveryError(
        'Account not found for recipient',
        'TARGET_GONE',
      )
    }
    if (!account.emailVerified) {
      throw new PermanentDeliveryError(
        'Recipient email is not verified',
        'TARGET_GONE',
      )
    }
    if (isPlaceholderEmail(account.email)) {
      throw new PermanentDeliveryError(
        'Recipient email is a placeholder',
        'TARGET_GONE',
      )
    }

    let unsubscribeUrl: string | undefined
    let unsubscribeHeaders:
      | { 'List-Unsubscribe': string; 'List-Unsubscribe-Post': string }
      | undefined
    let unsubscribeFooter: string | undefined
    if (args.snapshot.unsubscribeCategory) {
      const metadata = await buildEmailUnsubscribeMetadata({
        accountId: args.recipientAccountId,
        category: args.snapshot.unsubscribeCategory,
      })
      if (metadata) {
        unsubscribeUrl = metadata.url
        unsubscribeHeaders = metadata.headers
        unsubscribeFooter = metadata.textFooter
      }
    }

    let rendered: { subject: string; text: string; html: string }
    try {
      rendered = await renderSnapshotEmail({
        snapshot: args.snapshot,
        unsubscribeUrl,
        brandBaseUrl: getWebBaseUrl(),
      })
    } catch (error) {
      const { code, message } = describeError(error)
      throw new PermanentDeliveryError(
        `Email render failed: ${message}`,
        code || 'DATA_CONTRACT',
      )
    }

    const headers: Record<string, string> = {
      'Message-ID': deliveryMessageId(args.deliveryId),
    }
    if (unsubscribeHeaders) {
      headers['List-Unsubscribe'] = unsubscribeHeaders['List-Unsubscribe']
      headers['List-Unsubscribe-Post'] =
        unsubscribeHeaders['List-Unsubscribe-Post']
    }

    try {
      await sendEmail({
        to: account.email,
        subject: rendered.subject,
        text: `${rendered.text}${unsubscribeFooter ?? ''}`,
        html: rendered.html,
        headers,
      })
    } catch (error) {
      const { code, providerStatus, message } = describeError(error)
      if (classifySmtpError(error) === 'permanent') {
        throw new PermanentDeliveryError(
          `SMTP send failed: ${message}`,
          code,
          providerStatus,
        )
      }
      throw new TransientDeliveryError(
        `SMTP send failed: ${message}`,
        code,
        providerStatus,
      )
    }
  }
}

export const emailDeliverySender: EmailDeliverySender =
  new EmailDeliverySenderImpl()
