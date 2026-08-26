import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { useLocale } from '@/i18n/react'
import { detectDeviceTimeZone } from '@/lib/account-preferences'
import type { DateTimeStyle } from '@/lib/utils'
import { cn, formatZonedDate } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import { parseActivityData } from '@spliit/domain/activities'

export type Activity =
  AppRouterOutput['groups']['activities']['list']['activities'][number]

type Props = {
  groupId: string
  activity: Activity
  dateStyle: DateTimeStyle
}

function useMessage(activity: Activity) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Activities' })
  const data = parseActivityData(activity.data)
  const actor =
    activity.actorName ??
    (data?.kind === 'expense_comment' ? data.authorName : t('unknownActor'))

  if (!data) {
    return { message: t('fallback'), changes: null }
  }

  switch (data.kind) {
    case 'expense': {
      const title = data.title ?? activity.expense?.title ?? ''
      switch (activity.type) {
        case 'EXPENSE_CREATED':
          return {
            message: t('expense.created', { participant: actor, title }),
            changes: null,
          }
        case 'RECURRING_EXPENSE_CREATED':
          return {
            message: t('expense.recurringCreated', {
              participant: actor,
              title,
            }),
            changes: null,
          }
        case 'EXPENSE_UPDATED':
          return {
            message: t('expense.updated', { participant: actor, title }),
            changes:
              data.changes?.map((change) => ({
                field: change.field,
                label: t(`expense.changedFields.${change.field}` as const),
                before: change.before ?? null,
                after: change.after ?? null,
              })) ?? null,
          }
        case 'EXPENSE_DELETED':
          return {
            message: t('expense.deleted', { participant: actor, title }),
            changes: null,
          }
        default:
          return { message: t('fallback'), changes: null }
      }
    }
    case 'expense_comment':
      return {
        message: t('expense.commented', {
          participant: actor,
          title: data.expenseTitle,
          excerpt: data.excerpt,
        }),
        changes: null,
      }
    case 'group':
      switch (activity.type) {
        case 'GROUP_UPDATED':
          return {
            message: t('group.updated', { participant: actor }),
            changes:
              data.changes?.map((change) => ({
                field: change.field,
                label: t(`group.changedFields.${change.field}` as never, {
                  defaultValue: change.field,
                }),
                before: change.before ?? null,
                after: change.after ?? null,
              })) ?? null,
          }
        case 'GROUP_ARCHIVED':
          return {
            message: t('group.archived', { participant: actor }),
            changes: null,
          }
        case 'GROUP_UNARCHIVED':
          return {
            message: t('group.unarchived', { participant: actor }),
            changes: null,
          }
        case 'PARTICIPANT_REMOVED':
          return {
            message: t('participant.removed', {
              participant: actor,
              target: data.summary ?? '',
            }),
            changes: null,
          }
        default:
          return { message: t('fallback'), changes: null }
      }
    case 'member': {
      const targetName = data.targetDisplayName ?? data.displayName ?? ''
      switch (activity.type) {
        case 'MEMBER_LEFT':
          return {
            message: t('member.left', { participant: actor }),
            changes: null,
          }
        case 'MEMBER_REMOVED':
          return {
            message: t('member.removed', {
              participant: actor,
              target: targetName,
            }),
            changes: null,
          }
        case 'MEMBER_ROLE_CHANGED':
          return {
            message: t('member.roleChanged', {
              participant: actor,
              target: targetName,
              previousRole: data.previousRole,
              nextRole: data.nextRole,
            }),
            changes: null,
          }
        default:
          return { message: t('fallback'), changes: null }
      }
    }
    case 'invitation': {
      const displayLabel = data.displayLabel ?? ''
      switch (activity.type) {
        case 'INVITATION_CREATED':
          return {
            message: t('invitation.created', {
              participant: actor,
              target: displayLabel,
            }),
            changes: null,
          }
        case 'INVITATION_REVOKED':
          return {
            message: t('invitation.revoked', {
              participant: actor,
              target: displayLabel,
            }),
            changes: null,
          }
        case 'INVITATION_UPDATED':
          return {
            message: t('invitation.updated', {
              participant: actor,
              target: displayLabel,
            }),
            changes:
              data.changes?.map((change) => ({
                field: change.field,
                label: t(`invitation.changedFields.${change.field}` as never, {
                  defaultValue: change.field,
                }),
                before: change.before ?? null,
                after: change.after ?? null,
              })) ?? null,
          }
        case 'INVITATION_ACCEPTED':
          return {
            message: t('invitation.accepted', {
              target: displayLabel,
            }),
            changes: null,
          }
        case 'INVITATION_DECLINED':
          return {
            message: t('invitation.declined', {
              target: displayLabel,
            }),
            changes: null,
          }
        default:
          return { message: t('fallback'), changes: null }
      }
    }
    case 'import_summary':
      switch (activity.type) {
        case 'EXPENSES_IMPORTED':
          return {
            message: t('import.imported', {
              participant: actor,
              count: data.count,
              provider: data.sourceProvider ?? '',
            }),
            changes: null,
          }
        default:
          return { message: t('fallback'), changes: null }
      }
    case 'recurring_expense_stopped': {
      const title = data.title ?? ''
      return {
        message: t('expense.stopped', { participant: actor, title }),
        changes: null,
      }
    }
    default:
      return { message: t('fallback'), changes: null }
  }
}

function renderItemsDiff(before: string | null): ReactNode {
  if (!before) return null
  const lines = before.split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) return null
  return (
    <div className="space-y-0.5 tabular-nums">
      {lines.map((line, i) => {
        if (line.startsWith('- ')) {
          return (
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- diff lines from immutable string snapshot, no per-item identity
            <div key={i} className="text-muted-foreground/60 line-through">
              {line.slice(2)}
            </div>
          )
        }
        if (line.startsWith('+ ')) {
          return (
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- diff lines from immutable string snapshot, no per-item identity
            <div key={i} className="text-emerald-600 dark:text-emerald-400">
              {line.slice(2)}
            </div>
          )
        }
        // Modified line: "before → after" — render with the "before" half muted.
        const arrowIdx = line.lastIndexOf(' → ')
        if (arrowIdx > 0) {
          const beforeHalf = line.slice(0, arrowIdx)
          const afterHalf = line.slice(arrowIdx + 3)
          return (
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- diff lines from immutable string snapshot, no per-item identity
            <div key={i}>
              <span className="text-muted-foreground/60">{beforeHalf}</span>
              <span className="text-muted-foreground/40">{' → '}</span>
              <span>{afterHalf}</span>
            </div>
          )
        }
        // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- diff lines from immutable string snapshot, no per-item identity
        return <div key={i}>{line}</div>
      })}
    </div>
  )
}

export function ActivityItem({ groupId, activity, dateStyle }: Props) {
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'
  const locale = useLocale()
  const { t } = useTranslation(undefined, { keyPrefix: 'Activities' })
  const expenseExists = activity.expense != null
  const { message, changes } = useMessage(activity)
  const emptyValue = t('expense.changeEmptyValue')

  function formatChangeValue(value: string | null | undefined): string {
    return value && value.trim().length > 0 ? value : emptyValue
  }

  return (
    <div
      className={cn(
        'relative flex min-w-0 items-stretch justify-between gap-1 border-b px-4 py-2 text-sm hover:bg-accent sm:rounded-lg sm:border-b-0 sm:px-6',
        expenseExists && 'cursor-pointer',
      )}
      data-testid={`activity-item-${activity.id}`}
    >
      {expenseExists && activity.expense && (
        <Link
          to="/groups/$groupId/expenses/$expenseId"
          params={{ groupId, expenseId: activity.expense.id }}
          className="absolute inset-0 z-0 rounded-[inherit] outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('openExpense')}
        />
      )}
      <div className="flex shrink-0 flex-col items-start justify-between">
        {dateStyle !== undefined && (
          <div className="mt-1 text-xs/5 text-muted-foreground">
            {formatZonedDate(activity.time, locale, accountTimeZone, {
              dateStyle,
            })}
          </div>
        )}
        <div className="my-1 text-xs/5 text-muted-foreground">
          {formatZonedDate(activity.time, locale, accountTimeZone, {
            timeStyle: 'short',
          })}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="m-1 break-words">{message}</div>
        {changes && changes.length > 0 && (
          <div className="mx-1 mt-0.5 mb-1 min-w-0 space-y-0.5 border-s-2 border-muted-foreground/20 ps-2">
            {changes.map((change) => (
              <div
                key={change.field}
                className="grid min-w-0 grid-cols-[auto,minmax(0,1fr)] gap-x-2 text-xs"
                data-testid={`activity-item-${activity.id}-change-${change.field}`}
              >
                <span className="font-medium text-muted-foreground/80">
                  {change.label}
                </span>
                {change.field === 'items' ? (
                  <span className="min-w-0 break-words">
                    {renderItemsDiff(change.before)}
                  </span>
                ) : (
                  <span className="min-w-0 break-words tabular-nums">
                    <span className="text-muted-foreground/60">
                      {formatChangeValue(change.before)}
                    </span>
                    <span className="text-muted-foreground/40">{' → '}</span>
                    <span>{formatChangeValue(change.after)}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {expenseExists && (
        <ChevronRight
          className="pointer-events-none hidden h-4 w-4 self-center sm:flex rtl:rotate-180"
          aria-hidden="true"
        />
      )}
    </div>
  )
}
