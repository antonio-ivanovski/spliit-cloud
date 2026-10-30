import {
  createLazyFileRoute,
  getRouteApi,
  useNavigate,
} from '@tanstack/react-router'

import { currentPersonalMonth } from '@/app/personal/month'
import { PersonalOverviewPage } from '@/app/personal/page-overview'

const personalIndexRouteApi = getRouteApi('/personal/')

function PersonalOverviewRoute() {
  const navigate = useNavigate({ from: '/personal/' })
  let month: string | undefined
  try {
    month = personalIndexRouteApi.useSearch({
      shouldThrow: false,
    })?.month as string | undefined
  } catch {
    month = undefined
  }
  const resolvedMonth = month ?? currentPersonalMonth()

  return (
    <PersonalOverviewPage
      month={resolvedMonth}
      onMonthChange={(next) => {
        try {
          void navigate({
            search: (prev) => ({ ...prev, month: next }),
            replace: true,
          })
        } catch {
          // No router (unit test): the view already received the month.
        }
      }}
    />
  )
}

export const Route = createLazyFileRoute('/personal/')({
  component: PersonalOverviewRoute,
})
