import ImprintPage from '@/app/imprint'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/imprint')({
  component: ImprintPage,
})
