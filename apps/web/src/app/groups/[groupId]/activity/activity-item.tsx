import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/react'
import { useRouter } from '@/lib/navigation'
import type { DateTimeStyle } from '@/lib/utils'
import { cn, formatDate } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import { parseActivityData } from '@spliit/domain/activities'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type Activity =
  AppRouterOutput['groups']['activities']['list']['activities'][number]

type Props = {
  groupId: string
  activity: Activity
  dateStyle: DateTimeStyle
}

function useMessage(activity: Activity) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Activities' })
  const actor = activity.actorName ?? t('unknownActor')
  const data = parseActivityData(activity.data)

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
        case 'EXPENSE_UPDATED':
          return {
            message: t('expense.updated', { participant: actor, title }),
            changes: data.changes ?? null,
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
    case 'group':
      switch (activity.type) {
        case 'GROUP_UPDATED':
          return {
            message: t('group.updated', { participant: actor }),
            changes: null,
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
    default:
      return { message: t('fallback'), changes: null }
  }
}

export function ActivityItem({ groupId, activity, dateStyle }: Props) {
  const router = useRouter()
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
        'flex justify-between sm:rounded-lg px-2 sm:pr-1 sm:pl-2 py-2 text-sm hover:bg-accent gap-1 items-stretch',
        expenseExists && 'cursor-pointer',
      )}
      onClick={() => {
        if (expenseExists) {
          router.push({
            href: `/groups/${groupId}/expenses/${activity.expense!.id}/edit`,
          })
        }
      }}
      data-testid={`activity-item-${activity.id}`}
    >
      <div className="flex flex-col justify-between items-start">
        {dateStyle !== undefined && (
          <div className="mt-1 text-xs/5 text-muted-foreground">
            {formatDate(activity.time, locale, { dateStyle })}
          </div>
        )}
        <div className="my-1 text-xs/5 text-muted-foreground">
          {formatDate(activity.time, locale, { timeStyle: 'short' })}
        </div>
      </div>
      <div className="flex-1">
        <div className="m-1">{message}</div>
        {changes && changes.length > 0 && (
          <div className="mx-1 mt-0.5 mb-1 border-l-2 border-muted-foreground/20 pl-2 space-y-0.5">
            {changes.map((change, i) => (
              <div
                key={`${change.field}-${i}`}
                className="grid grid-cols-[auto,1fr] gap-x-2 text-xs"
                data-testid={`activity-item-${activity.id}-change-${change.field}`}
              >
                <span className="font-medium text-muted-foreground/80">
                  {t(`expense.changedFields.${change.field}` as const)}
                </span>
                <span className="tabular-nums">
                  <span className="text-muted-foreground/60">
                    {formatChangeValue(change.before)}
                  </span>
                  <span className="text-muted-foreground/40">{' → '}</span>
                  <span>{formatChangeValue(change.after)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {expenseExists && (
        <Button
          size="icon"
          variant="link"
          className="self-center hidden sm:flex w-5 h-5"
          asChild
        >
          <a href={`/groups/${groupId}/expenses/${activity.expense!.id}/edit`}>
            <ChevronRight className="w-4 h-4" />
          </a>
        </Button>
      )}
    </div>
  )
}
