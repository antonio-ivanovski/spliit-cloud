'use client'

import { trpc } from '@/trpc/client'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { RecentGroupListCard } from './recent-group-list-card'

export function AuthenticatedGroupList() {
  const t = useTranslations('Groups')
  const { data: groups, isLoading } = trpc.userGroups.list.useQuery()

  if (isLoading) {
    return (
      <div className="text-sm space-y-4">
        <p>
          <Loader2 className="w-4 m-4 mr-2 inline animate-spin" />
          {t('loadingRecent')}
        </p>
      </div>
    )
  }

  if (!groups || groups.length === 0) {
    return (
      <div className="text-sm space-y-2">
        <p>{t('NoRecent.description')}</p>
        <p>
          <Button variant="link" asChild className="-m-4">
            <Link href="/groups/create">{t('NoRecent.create')}</Link>
          </Button>
          {' or join using an invite link.'}
        </p>
      </div>
    )
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {groups.map((group) => (
        <RecentGroupListCard
          key={group.id}
          group={{ id: group.id, name: group.name }}
          isStarred={false}
          isArchived={false}
          refreshGroupsFromStorage={() => {}}
        />
      ))}
    </ul>
  )
}
