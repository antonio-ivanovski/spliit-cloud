'use client'

import { GroupTabs } from '@/app/groups/[groupId]/group-tabs'
import Link from '@/components/link'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrentGroup } from './current-group-context'

export const GroupHeader = () => {
  const { isLoading, groupId, group } = useCurrentGroup()

  return (
    <div className="flex flex-col justify-between gap-3">
      <h1 className="font-bold text-2xl">
        <Link href={`/groups/${groupId}`}>
          {isLoading ? (
            <Skeleton className="mt-1.5 mb-1.5 h-5 w-32" />
          ) : (
            <div className="flex">{group.name}</div>
          )}
        </Link>
      </h1>

      <div className="flex flex-col gap-3">
        <GroupTabs groupId={groupId} />
      </div>
    </div>
  )
}
