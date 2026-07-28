import { createLazyFileRoute } from '@tanstack/react-router'

import { EditGroup } from '@/app/groups/[groupId]/edit/edit-group'

export const Route = createLazyFileRoute('/groups/$groupId/edit')({
  component: EditGroup,
})
