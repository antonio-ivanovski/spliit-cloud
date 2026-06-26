'use client'
import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/react'
import { useRouter } from '@/lib/navigation'
import { DateTimeStyle, cn, formatDate } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import { ChevronRight } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'

export type Activity =
  AppRouterOutput['groups']['activities']['list']['activities'][number]

const ActivityType = {
  UPDATE_GROUP: 'UPDATE_GROUP',
  CREATE_EXPENSE: 'CREATE_EXPENSE',
  UPDATE_EXPENSE: 'UPDATE_EXPENSE',
  DELETE_EXPENSE: 'DELETE_EXPENSE',
} as const

type ActivitySummaryKey =
  | 'Activity.settingsModified'
  | 'Activity.expenseCreated'
  | 'Activity.expenseUpdated'
  | 'Activity.expenseDeleted'

const summaryKeyByActivityType: Record<
  (typeof ActivityType)[keyof typeof ActivityType],
  ActivitySummaryKey
> = {
  UPDATE_GROUP: 'Activity.settingsModified',
  CREATE_EXPENSE: 'Activity.expenseCreated',
  UPDATE_EXPENSE: 'Activity.expenseUpdated',
  DELETE_EXPENSE: 'Activity.expenseDeleted',
}

type Props = {
  groupId: string
  activity: Activity
  dateStyle: DateTimeStyle
}

function useSummary(activity: Activity) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Activity' })
  const participant = activity.actorName ?? t('someone')
  const expense = activity.data ?? ''
  const i18nKey = summaryKeyByActivityType[activity.activityType]

  return (
    <Trans
      i18nKey={i18nKey}
      values={{ expense, participant }}
      components={{
        em: <em />,
        strong: <strong />,
      }}
    />
  )
}

export function ActivityItem({ groupId, activity, dateStyle }: Props) {
  const router = useRouter()
  const locale = useLocale()

  const expenseExists = activity.expense !== undefined
  const summary = useSummary(activity)

  return (
    <div
      className={cn(
        'flex justify-between sm:rounded-lg px-2 sm:pr-1 sm:pl-2 py-2 text-sm hover:bg-accent gap-1 items-stretch',
        expenseExists && 'cursor-pointer',
      )}
      onClick={() => {
        if (expenseExists) {
          router.push({
            href: `/groups/${groupId}/expenses/${activity.expenseId}/edit`,
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
        <div className="m-1">{summary}</div>
      </div>
      {expenseExists && (
        <Button
          size="icon"
          variant="link"
          className="self-center hidden sm:flex w-5 h-5"
          asChild
        >
          <Link href={`/groups/${groupId}/expenses/${activity.expenseId}/edit`}>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </Button>
      )}
    </div>
  )
}
