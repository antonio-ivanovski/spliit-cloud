import { z } from 'zod'

export const expenseCommentOutputSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.date(),
  author: z.object({
    accountId: z.string().nullable(),
    name: z.string(),
    image: z.string().nullable(),
  }),
  canDelete: z.boolean(),
})

export const listExpenseCommentsOutputSchema = z.object({
  comments: z.array(expenseCommentOutputSchema),
})

export const createExpenseCommentOutputSchema = z.object({
  comment: expenseCommentOutputSchema,
})

export const deleteExpenseCommentOutputSchema = z.object({})
