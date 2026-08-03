import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

const reportPrintSearchSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export const Route = createFileRoute('/groups/$groupId/expenses/print')({
  validateSearch: reportPrintSearchSchema,
})
