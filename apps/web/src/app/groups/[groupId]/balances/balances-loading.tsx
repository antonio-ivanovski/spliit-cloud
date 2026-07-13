import { Skeleton } from '@/components/ui/skeleton'

export function ReimbursementsLoading({
  participantCount = 3,
}: {
  participantCount?: number
}) {
  return (
    <div className="flex flex-col">
      {Array(participantCount - 1)
        .fill(undefined)
        .map((_, index) => (
          <div key={index} className="flex justify-between py-5">
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
    </div>
  )
}

export function BalancesLoading({
  participantCount = 3,
}: {
  participantCount?: number
}) {
  const rows = Math.max(2, Math.min(participantCount, 4))

  return (
    <div className="space-y-7 py-1">
      {[0, 1].map((section) => (
        <section key={section} className="space-y-4">
          <Skeleton className="h-3 w-20" />
          <div className="space-y-5">
            {Array(section === 0 ? Math.ceil(rows / 2) : Math.floor(rows / 2))
              .fill(undefined)
              .map((_, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Skeleton className="size-7 rounded-full" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <Skeleton className="h-2.5 w-full rounded-full" />
                  <div className="flex gap-4">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
          </div>
        </section>
      ))}
    </div>
  )
}
