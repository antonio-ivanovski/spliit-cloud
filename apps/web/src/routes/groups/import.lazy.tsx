import { createLazyFileRoute } from '@tanstack/react-router'

import { ImportGroupWizard } from '@/app/groups/import/import-group-wizard'

export const Route = createLazyFileRoute('/groups/import')({
  component: ImportGroupWizard,
})
