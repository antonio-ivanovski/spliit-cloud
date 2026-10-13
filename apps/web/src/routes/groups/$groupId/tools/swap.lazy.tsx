import { createLazyFileRoute } from '@tanstack/react-router'

import { CurrencySwapPage } from '@/app/groups/[groupId]/tools/swap/swap-page'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createLazyFileRoute('/groups/$groupId/tools/swap')({
  component: CurrencySwapPage,
  pendingComponent: () => (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  ),
})
