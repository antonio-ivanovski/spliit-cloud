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
    return t('fallback')
  }

  switch (data.kind) {
    case 'expense': {
      const title = data.title ?? activity.expense?.title ?? ''
      switch (activity.type) {
        case 'EXPENSE_CREATED':
          return t('expense.created', { participant: actor, title })
        case 'EXPENSE_UPDATED': {
          const changedFieldLabels =
            data.changedFields?.map((f) =>
              t(`expense.changedFields.${f}` as const),
            ) ?? []
          const changes =
            changedFieldLabels.length > 0
              ? t('expense.changedFieldsSummary', {
                  fields: changedFieldLabels.join(', '),
                })
              : ''
          return t('expense.updated', {
            participant: actor,
            title,
            changes,
          })
        }
        case 'EXPENSE_DELETED':
          return t('expense.deleted', { participant: actor, title })
        default:
          return t('fallback')
      }
    }
    case 'group':
      switch (activity.type) {
        case 'GROUP_UPDATED':
          return t('group.updated', { participant: actor })
        case 'GROUP_ARCHIVED':
          return t('group.archived', { participant: actor })
        case 'GROUP_UNARCHIVED':
          return t('group.unarchived', { participant: actor })
        default:
          return t('fallback')
      }
    case 'member': {
      const targetName =
        data.targetDisplayName ?? data.displayName ?? ''
      switch (activity.type) {
        case 'MEMBER_LEFT':
          return t('member.left', { participant: actor })
        case 'MEMBER_REMOVED':
          return t('member.removed', {
            participant: actor,
            target: targetName,
          })
        case 'MEMBER_ROLE_CHANGED':
          return t('member.roleChanged', {
            participant: actor,
            target: targetName,
            previousRole: data.previousRole,
            nextRole: data.nextRole,
          })
        default:
          return t('fallback')
      }
    }
    case 'invitation': {
      const displayLabel = data.displayLabel ?? ''
      switch (activity.type) {
        case 'INVITATION_CREATED':
          return t('invitation.created', {
            participant: actor,
            target: displayLabel,
          })
        case 'INVITATION_REVOKED':
          return t('invitation.revoked', {
            participant: actor,
            target: displayLabel,
          })
        case 'INVITATION_ACCEPTED':
          return t('invitation.accepted', {
            target: displayLabel,
          })
        case 'INVITATION_DECLINED':
          return t('invitation.declined', {
            target: displayLabel,
          })
        default:
          return t('fallback')
      }
    }
    default:
      return t('fallback')
  }
}

export function ActivityItem({ groupId, activity, dateStyle }: Props) {
  const router = useRouter()
  const locale = useLocale()
  const expenseExists = activity.expense != null
  const message = useMessage(activity)

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
