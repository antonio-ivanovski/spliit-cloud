import HomePage from '@/app/page'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/')({
  component: HomePage,
})
