import { EditGroup } from '@/app/groups/[groupId]/edit/edit-group'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/groups/$groupId/edit')({
  component: EditGroup,
})
