import { createFileRoute } from '@tanstack/react-router'

import { personalSearchSchema } from '@/router/schemas'

export const Route = createFileRoute('/personal/')({
  validateSearch: personalSearchSchema,
})
