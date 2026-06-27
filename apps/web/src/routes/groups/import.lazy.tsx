import { ImportGroupWizard } from '@/app/groups/import/import-group-wizard'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/groups/import')({
  component: ImportGroupWizard,
})
