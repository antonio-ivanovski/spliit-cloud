import { CreateGroup } from '@/app/groups/create/create-group'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/groups/create')({
  component: CreateGroup,
})
