import type { Prisma } from '@spliit/db'
import { defaultLocale, type BudgetPeriod } from '@spliit/domain'
import {
  NotificationSnapshotVersion,
  emailTargetKey,
  pushTargetKey,
} from '@spliit/domain/notification-delivery'
import {
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'
import {
  JOB_NAMES,
  bossTransactionDb,
  insertJobs,
  type SpliitBoss,
} from '@spliit/jobs'

import { randomId } from '../api/shared'
import { getWebBaseUrl } from '../auth/urls'
import { resolveNotificationChannelsForIntents } from './coordinator-policy'
import { formatNotificationAmount } from './format'

export async function planBudgetAlertDeliveries(args: {
  budget: {
    id: string
    groupId: string
    name: string
    amount: number
    ledgerId: string
    participantScope: string
    participantIds: string[]
    periodStart: Date
    periodEnd: Date
    alertType: 'TRENDING_OVER' | 'OVER'
    used: number
    currencyCode: string | null
    period?: BudgetPeriod
  }
  tx: Prisma.TransactionClient
  boss: SpliitBoss | null
}): Promise<string[]> {
  const { budget, tx, boss } = args
  const rows = await tx.ledgerParticipant.findMany({
    where: {
      ledgerId: budget.ledgerId,
      kind: 'ACCOUNT_MEMBER',
      removedAt: null,
      ...(budget.participantScope === 'SELECTED'
        ? { id: { in: budget.participantIds } }
        : {}),
    },
    select: {
      id: true,
      groupMember: {
        select: {
          accountId: true,
          status: true,
          account: {
            select: {
              id: true,
              name: true,
              preference: { select: { locale: true, timeZone: true } },
            },
          },
        },
      },
    },
  })
  const accountIds = [
    ...new Set(
      rows
        .filter((row) => row.groupMember?.status === 'ACTIVE')
        .map((row) => row.groupMember?.accountId)
        .filter((id): id is string => !!id),
    ),
  ]
  const eventKey = `budget:${budget.id}:${budget.periodStart.toISOString().slice(0, 10)}:${budget.alertType}`
  const intents = accountIds.map((recipientAccountId) => ({
    recipientAccountId,
    category: NotificationCategory.BUDGET_ALERT,
    activity: {
      activityId: null,
      customEventKey: eventKey,
      groupId: budget.groupId,
      actor: null,
      subject: null,
      type: 'EXPENSE_CREATED' as const,
      data: {
        kind: 'expense' as const,
        expense: {
          id: budget.id,
          title: budget.name,
          amount: budget.amount,
          currencyCode: budget.currencyCode,
        },
      },
      occurredAt: new Date(),
    },
  }))
  const plans = await resolveNotificationChannelsForIntents(intents, tx)
  const pushMap = plans[0]?.pushSubscriptionsByAccountId ?? new Map()
  const group = await tx.group.findUnique({
    where: { id: budget.groupId },
    select: { id: true, name: true, groupType: true },
  })
  const ids: string[] = []
  const budgetUrl = `${getWebBaseUrl()}/groups/${budget.groupId}/budgets/${budget.id}`
  const accountById = new Map(
    rows.flatMap((row) =>
      row.groupMember?.account
        ? [[row.groupMember.account.id, row.groupMember.account]]
        : [],
    ),
  )
  for (let index = 0; index < accountIds.length; index++) {
    const accountId = accountIds[index]!
    const recipientAccount = accountById.get(accountId)
    const locale = recipientAccount?.preference?.locale ?? defaultLocale
    for (const channel of plans[index]?.channels ?? []) {
      const targets =
        channel === NotificationChannel.PUSH
          ? (pushMap.get(accountId) ?? [])
          : [{ id: null }]
      for (const target of targets) {
        const usedLabel =
          formatNotificationAmount(budget.used, budget.currencyCode, locale) ??
          String(budget.used)
        const limitLabel =
          formatNotificationAmount(
            budget.amount,
            budget.currencyCode,
            locale,
          ) ?? String(budget.amount)
        const targetKey =
          channel === NotificationChannel.PUSH
            ? pushTargetKey(target.id!)
            : emailTargetKey(accountId)
        const snapshot = {
          version: NotificationSnapshotVersion.V1,
          kind: 'budget_alert' as const,
          category: NotificationCategory.BUDGET_ALERT,
          occurredAt: new Date().toISOString(),
          actor: null,
          recipient: {
            accountId,
            displayName: recipientAccount?.name ?? '',
            locale,
            ...(recipientAccount?.preference?.timeZone
              ? { timeZone: recipientAccount.preference.timeZone }
              : {}),
          },
          unsubscribeCategory: NotificationCategory.BUDGET_ALERT,
          push:
            channel === NotificationChannel.PUSH
              ? {
                  subscriptionId: target.id!,
                  title:
                    budget.alertType === 'OVER'
                      ? `Budget exceeded: ${budget.name}`
                      : `Budget trending over: ${budget.name}`,
                  body: `${usedLabel} of ${limitLabel}`,
                  url: budgetUrl,
                  tag: eventKey,
                }
              : undefined,
          budget: {
            id: budget.id,
            name: budget.name,
            used: budget.used,
            limit: budget.amount,
            currencyCode: budget.currencyCode,
            alertType: budget.alertType,
            periodStart: budget.periodStart.toISOString(),
            periodEnd: budget.periodEnd.toISOString(),
            period: budget.period,
          },
          group: {
            id: group?.id ?? budget.groupId,
            name: group?.name ?? '',
            type: group?.groupType ?? 'GROUP',
          },
          link: budgetUrl,
        }
        const id = randomId()
        const created = await tx.notificationDelivery.createMany({
          data: [
            {
              id,
              eventKey,
              activityId: null,
              recipientAccountId: accountId,
              category: NotificationCategory.BUDGET_ALERT,
              channel,
              targetKey,
              pushSubscriptionId:
                channel === NotificationChannel.PUSH ? target.id : null,
              snapshotVersion: NotificationSnapshotVersion.V1,
              snapshot: snapshot as unknown as Prisma.InputJsonValue,
              status: 'PENDING',
            },
          ],
          skipDuplicates: true,
        })
        if (created.count > 0) ids.push(id)
      }
    }
  }
  if (boss && ids.length)
    await insertJobs(
      boss,
      JOB_NAMES.NOTIFICATION_DELIVER,
      ids.map((deliveryId) => ({ deliveryId })),
      { db: bossTransactionDb(tx) },
    )
  return ids
}
