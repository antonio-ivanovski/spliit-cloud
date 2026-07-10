import { CurrencyMigrationPage } from '@/app/groups/[groupId]/edit/currency-migration'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute(
  '/groups/$groupId/edit/currency-migration',
)({
  component: CurrencyMigrationPage,
})
