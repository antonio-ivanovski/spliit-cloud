import type { Currency } from '@/lib/currency'
import { lazy, Suspense } from 'react'
import type { StatsDashboardData } from './dashboard-types'

type Props = {
  data: StatsDashboardData
  currency: Currency
}

const SpendingChartImpl = lazy(() =>
  import('./spending-chart-impl').then((mod) => ({
    default: mod.SpendingChart,
  })),
)

export function SpendingChart(props: Props) {
  return (
    <Suspense fallback={null}>
      <SpendingChartImpl {...props} />
    </Suspense>
  )
}
