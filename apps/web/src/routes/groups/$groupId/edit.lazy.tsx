import { createLazyFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/groups/$groupId/edit')({
  component: () => <Outlet />,
})
